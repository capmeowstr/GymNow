#!/usr/bin/env python3
"""Build the small native APK with JDK 17+ and Android SDK tools (no Gradle)."""
from argparse import ArgumentParser
from pathlib import Path
import os, subprocess, zipfile, secrets, shutil, hashlib, urllib.request

parser = ArgumentParser(description=__doc__)
parser.add_argument('--unsigned', action='store_true', help='Build an aligned APK for release signing.')
args = parser.parse_args()

root = Path(__file__).resolve().parent
tools = Path(os.environ.get('GYM_NOW_TOOLCHAIN', root.parent / 'android-toolchain')).resolve()
build = root / 'build'
build.mkdir(exist_ok=True)
output = root.parent / ('Gym_Now_v0_3_3-unsigned.apk' if args.unsigned else 'Gym_Now_v0_3_3.apk')

def run(*args):
    subprocess.run([str(a) for a in args], cwd=root, check=True)

def require_tools():
    packages = [
        ('platform-35_r02.zip','0bb560a90a7a2cbd0dd8348224d518b638fe7949'),
        ('build-tools_r35_linux.zip','2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc'),
    ]
    tools.mkdir(parents=True, exist_ok=True)
    for name, checksum in packages:
        needed = tools / ('android-35/android.jar' if name.startswith('platform') else 'android-15/aapt2')
        if needed.exists(): continue
        archive = tools / name
        if not archive.exists(): urllib.request.urlretrieve('https://dl.google.com/android/repository/'+name, archive)
        if hashlib.sha1(archive.read_bytes()).hexdigest() != checksum: raise RuntimeError('Android tool checksum mismatch')
        with zipfile.ZipFile(archive) as z:
            z.extractall(tools)
            for info in z.infolist():
                mode = info.external_attr >> 16
                if mode: os.chmod(tools / info.filename, mode)

run('node','--test',root/'tests/booking-engine.test.js')
run('node','--test',root/'tests/runner.test.js')
run('node','--test',root/'tests/login.test.js')
run('node','--check',root/'assets/runner.js')
run('node','--check',root/'assets/entry-selector.js')
run('node','--check',root/'assets/login.js')
require_tools()
bt = tools / 'android-15'
android = tools / 'android-35/android.jar'
for directory in ['gen','classes','dex','policy-test']:
    path = build / directory
    if path.exists(): shutil.rmtree(path)
    path.mkdir()
run('java','com.sun.tools.javac.Main','--release','8','-d',build/'policy-test',root/'src/dev/gymnow/ark/AppPolicy.java',root/'tests/AppPolicyTest.java')
run('java','-cp',build/'policy-test','AppPolicyTest')
run('java','com.sun.tools.javac.Main','--release','8','-d',build/'policy-test',root/'src/dev/gymnow/ark/CredentialCipher.java',root/'tests/CredentialCipherTest.java')
run('java','-cp',build/'policy-test','CredentialCipherTest')
run(bt/'aapt2','compile','--dir',root/'res','-o',build/'resources.zip')
run(bt/'aapt2','link','--manifest',root/'AndroidManifest.xml','-I',android,'-A',root/'assets','--java',build/'gen','-o',build/'resources.apk',build/'resources.zip')
sources = sorted((root/'src').rglob('*.java')) + sorted((build/'gen').rglob('*.java'))
run('java','com.sun.tools.javac.Main','--release','8','-classpath',android,'-d',build/'classes',*sources)
classes = sorted((build/'classes').rglob('*.class'))
run(bt/'d8','--release','--lib',android,'--min-api','26','--output',build/'dex',*classes)
shutil.copyfile(build/'resources.apk',build/'unsigned.apk')
with zipfile.ZipFile(build/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
    for dex in sorted((build/'dex').glob('*.dex')): z.write(dex,dex.name)
run(bt/'zipalign','-p','-f','4',build/'unsigned.apk',build/'aligned.apk')
if args.unsigned:
    shutil.copyfile(build/'aligned.apk', output)
else:
    signing = root / '.signing'
    signing.mkdir(mode=0o700,exist_ok=True)
    password = signing / 'password.txt'
    key = signing / 'gym-now.p12'
    if not password.exists():
        password.write_text(secrets.token_urlsafe(36)+'\n')
        password.chmod(0o600)
    if not key.exists():
        run('keytool','-genkeypair','-alias','gym-now','-keystore',key,'-storetype','PKCS12','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Gym Now personal build', '-storepass:file',password,'-keypass:file',password)
        key.chmod(0o600)
    run(bt/'apksigner','sign','--ks',key,'--ks-key-alias','gym-now','--ks-pass','file:'+str(password),'--v4-signing-enabled','false','--out',output,build/'aligned.apk')
    run(bt/'apksigner','verify','--verbose','--print-certs',output)
run(bt/'zipalign','-c','-v','4',output)
print('APK:',output)
print('APK SHA-256:',hashlib.sha256(output.read_bytes()).hexdigest())
