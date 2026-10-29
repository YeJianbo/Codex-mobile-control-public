from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,shutil,hashlib,subprocess,re,argparse,tempfile
from datetime import datetime,timezone
root=Path(__file__).resolve().parents[1]
android_version=re.search(r'versionName\s*=\s*"([^"]+)"',(root/'android/app/build.gradle.kts').read_text(encoding='utf-8')).group(1)
parser=argparse.ArgumentParser();parser.add_argument('--version',default=android_version)
parser.add_argument('--output-dir',type=Path,default=root/'deliverables',help='Directory for the setup, release ZIP and manifest')
parser.add_argument('--android-build-dir',type=Path,default=root/'android/app/build',help='Android app build directory containing release output metadata')
parser.add_argument('--android-apk',type=Path,help='Release APK to package; defaults to the versioned APK in artifacts')
parser.add_argument('--android-build-log',type=Path,help='Build log belonging to the provided Android APK')
parser.add_argument('--android-notes-file',type=Path,help='UTF-8 Android release notes shown in the in-app updater')
parser.add_argument('--console-dir',type=Path,default=root/'components/local-console',help='Versioned Local Console component source and frontend')
parser.add_argument('--console-runtime-dir',type=Path,default=Path.home()/'.codex/tools/local-console',help='Installed dependency and Node cache matching the component lockfiles')
args=parser.parse_args();version=args.version
assert re.fullmatch(r'\d+\.\d+\.\d+',version),'Invalid desktop release version'
gateway_version=json.loads((root/'server/package.json').read_text(encoding='utf-8'))['version']
# The staged runtime and embedded payload can exceed space on the checkout
# drive. Both are rebuildable, so use the OS temporary directory.
scratch=tempfile.TemporaryDirectory(prefix=f'cmc-release-{version}-')
scratch_root=Path(scratch.name).resolve();stage=scratch_root/'stage/local-console'
work=scratch_root/'build';work.mkdir(parents=True,exist_ok=True)
console=args.console_dir.expanduser().resolve()
console_runtime=args.console_runtime_dir.expanduser().resolve()
console_version=json.loads((console/'package.json').read_text(encoding='utf-8'))['version']
apk=args.android_apk.expanduser().resolve() if args.android_apk else root/f'artifacts/Codex-Control-{android_version}.apk'
android_log=args.android_build_log.expanduser().resolve() if args.android_build_log else root/f'artifacts/android-{android_version}-build.log'
assert android_log.is_file(),'Provide the Android build log with --android-build-log'
metadata=json.loads((args.android_build_dir.expanduser().resolve()/'outputs/apk/release/output-metadata.json').read_text(encoding='utf-8'))
assert metadata['elements'][0]['versionName']==android_version and apk.is_file(),'Build and provide the current Release APK first'
stage.mkdir(parents=True,exist_ok=True)
version_source=work/'version.cs'
version_source.write_text(f'using System.Reflection;\n[assembly: AssemblyVersion("{version}.0")]\n[assembly: AssemblyFileVersion("{version}.0")]\n')
compiler=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
compile_flags=['/nologo','/target:winexe','/platform:x64','/optimize+','/debug-','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll']
manager=subprocess.run([str(compiler),*compile_flags,f'/out:{work/"CodexControl.exe"}',str(root/'installer/Desktop.cs'),str(version_source)],capture_output=True)
(work/'desktop-build-final.log').write_bytes(manager.stdout+manager.stderr)
assert manager.returncode==0,'Native manager compilation failed'
for source,destination in [(console/'src',stage/'src'),(console/'dist',stage/'dist'),(root/'server/dist',stage/'gateway/dist'),(root/'server/public',stage/'gateway/public'),(root/'server/scripts',stage/'gateway/scripts'),(root/'installer',stage/'installer')]:
    shutil.copytree(source,destination,dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.before-*','*.bak','*.cpuprofile','__pycache__'))
# The embedded download must match the APK shipped beside the installer.
(stage/'gateway/public/downloads').mkdir(parents=True,exist_ok=True)
shutil.copy2(apk,stage/'gateway/public/downloads/android.apk')
release={'packageName':metadata['applicationId'],'versionName':metadata['elements'][0]['versionName'],
         'versionCode':metadata['elements'][0]['versionCode'],'size':apk.stat().st_size,
         'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),
         'notes':args.android_notes_file.read_text(encoding='utf-8') if args.android_notes_file else '',
         'publishedAt':datetime.now(timezone.utc).isoformat()}
(stage/'gateway/public/downloads/android.json').write_text(json.dumps(release,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ('package.json','package-lock.json'):
    shutil.copy2(console/name,stage/name);shutil.copy2(root/'server'/name,stage/'gateway'/name)
# Copy the verified production closure from the authoritative checkout. This
# avoids downloading or rebuilding native modules on the target computer.
packages=[]
for source,destination in [(console,stage),(root/'server',stage/'gateway')]:
    lock=json.loads((source/'package-lock.json').read_text(encoding='utf-8'))
    for relative,meta in lock['packages'].items():
        if not relative or meta.get('dev') or meta.get('link'):continue
        original=(console_runtime if source==console else source)/relative
        if not original.exists():
            if meta.get('optional'):continue
            raise RuntimeError(f'Runtime dependency missing: {relative}')
        actual=json.loads((original/'package.json').read_text(encoding='utf-8'))
        assert actual['version']==meta['version'],relative
        shutil.copytree(original,destination/relative,dirs_exist_ok=True)
        packages.append({'component':destination.name,'name':actual['name'],'version':actual['version']})
runtime=stage/'runtime';runtime.mkdir(exist_ok=True)
node=console_runtime/'runtime/node.exe'
node_version=subprocess.check_output([str(node),'--version'],text=True).strip().removeprefix('v')
expected=next(line.split()[0] for line in (console/'runtime/SHASUMS256.txt').read_text(encoding='utf-8').splitlines() if line.endswith('win-x64/node.exe'))
assert hashlib.sha256(node.read_bytes()).hexdigest()==expected
shutil.copy2(node,runtime/'node.exe');shutil.copy2(console/'runtime/LICENSE.txt',runtime/'LICENSE.txt')
shutil.copy2(console/'runtime/SHASUMS256.txt',runtime/'SHASUMS256.txt')
shutil.copy2(work/'CodexControl.exe',stage/'CodexControl.exe')
docs=stage/'docs';docs.mkdir(exist_ok=True)
shutil.copy2(root/'docs/installation.md',docs/'安装使用说明.md')
shutil.copy2(root/'docs/mobile-usage.md',docs/'mobile-usage.md')
shutil.copy2(root/'docs/harnesses.md',docs/'harnesses.md')
shutil.copy2(root/'docs/feature-parity.md',docs/'feature-parity.md')
shutil.copy2(root/'docs/harness-icons.md',docs/'harness-icons.md')
for script in (stage/'installer').glob('*.ps1'):
    text=script.read_text(encoding='utf-8-sig');script.write_text(text,encoding='utf-8-sig')
ps_files=','.join("'"+str(stage/'installer'/name).replace("'","''")+"'" for name in ('Common.ps1','Install.ps1','Uninstall.ps1'))
ps_command="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $failed=$false; foreach($file in @("+ps_files+")){$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors);foreach($error in $errors){Write-Output ($file+': '+$error.Message);$failed=$true}};if($failed){exit 1}"
ps_build=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',ps_command],capture_output=True)
(work/'powershell-build.log').write_bytes(ps_build.stdout+ps_build.stderr)
assert ps_build.returncode==0,'Installer PowerShell syntax check failed'
# installation.json and all credentials are generated on the target machine.
for name in ('installation.json','server.json','public-access.json','public-password.txt','auth.json','state.sqlite'):
    assert not (stage/name).exists()
release={'version':version,'gatewayVersion':gateway_version,'consoleVersion':console_version,'nodeVersion':node_version,'platform':'win32-x64','productionDependencies':packages}
(stage/'release.json').write_text(json.dumps(release,ensure_ascii=False,indent=2),encoding='utf-8')
payload=scratch_root/'payload.zip'
with ZipFile(payload,'w',ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(stage.rglob('*')):
        relative=file.relative_to(stage).as_posix()
        if file.is_file() and relative not in ('installer/build-release.py','installer/Desktop.cs','installer/release-smoke.mjs'):z.write(file,'local-console/'+relative)
with ZipFile(payload) as z:assert z.testzip() is None
# All staged files now live in the verified payload; release the rebuildable
# copy before creating the setup and bundle.
assert stage.resolve()==scratch_root/'stage/local-console'
shutil.rmtree(stage)
dest=args.output_dir.expanduser().resolve();dest.mkdir(parents=True,exist_ok=True)
setup=dest/f'Codex-Control-{version}-Setup-x64.exe'
result=subprocess.run([str(compiler),*compile_flags,f'/resource:{payload},payload.zip',f'/out:{setup}',str(root/'installer/Desktop.cs'),str(version_source)],capture_output=True)
(work/'setup-build.log').write_bytes(result.stdout+result.stderr)
assert result.returncode==0,'Setup compilation failed'
manifest={**{key:value for key,value in release.items() if key!='productionDependencies'},'android':{'versionName':android_version,'versionCode':metadata['elements'][0]['versionCode'],'packageName':metadata['applicationId']},'setupBytes':setup.stat().st_size,'payloadBytes':payload.stat().st_size,'productionPackages':len(packages),'checks':{'desktopBuild':True,'setupBuild':True,'powershellSyntax':True,'dependencyVersions':True,'nodeChecksum':True,'payloadCrc':True,'installedOnTarget':False,'physicalPhoneChecked':False}}
manifest_file=dest/f'windows-release-manifest-{version}.json'
manifest_file.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
bundle=dest/f'Codex-Control-{version}-Windows-x64-Release.zip'
with ZipFile(bundle,'w',ZIP_DEFLATED,compresslevel=6) as z:
    for file,name in [(setup,setup.name),(apk,f'Codex-Control-{android_version}.apk'),(root/'docs/installation.md','安装使用说明.md'),(root/'docs/mobile-usage.md','mobile-usage.md'),(root/'docs/harnesses.md','harnesses.md'),(root/'docs/harness-icons.md','harness-icons.md'),(manifest_file,'release-manifest.json'),(work/'desktop-build-final.log','desktop-build.log'),(work/'setup-build.log','setup-build.log'),(work/'powershell-build.log','powershell-build.log'),(android_log,'android-build.log')]:z.write(file,name)
with ZipFile(bundle) as z:assert z.testzip() is None
print(json.dumps({'setup':str(setup),'bundle':str(bundle),'bytes':setup.stat().st_size,'bundleBytes':bundle.stat().st_size,'payloadBytes':payload.stat().st_size,'productionPackages':len(packages)}))
scratch.cleanup()
