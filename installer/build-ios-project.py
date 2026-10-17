"""Package the editable iOS project; structural checks do not replace Xcode."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import json
import plistlib
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
source = root / 'ios'
project = source / 'CodexControl.xcodeproj/project.pbxproj'
text = project.read_text(encoding='utf-8')
defined = set(re.findall(r'^\s*([A-F0-9]{24})\s*=\s*\{', text, re.M))
referenced = set(re.findall(r'\b[A-F0-9]{24}\b', text))
assert referenced <= defined, 'Undefined project object reference'
for name in re.findall(r'path = ([A-Za-z]+\.swift);', text):
    assert (source / 'CodexControl' / name).is_file(), name
info = plistlib.loads((source / 'CodexControl/Info.plist').read_bytes())
assert info['NSAppTransportSecurity'] == {'NSAllowsLocalNetworking': True}
scheme = ET.parse(source / 'CodexControl.xcodeproj/xcshareddata/xcschemes/CodexControl.xcscheme')
assert all(node.attrib['BlueprintIdentifier'] in defined for node in scheme.findall('.//BuildableReference'))
version = re.search(r'MARKETING_VERSION = ([\d.]+);', text).group(1)
destination = args.output_dir.resolve()
destination.mkdir(parents=True, exist_ok=True)
archive = destination / f'Codex-Control-{version}-iOS-Project.zip'
files = [*source.rglob('*.swift'), source / 'CodexControl/Info.plist', project,
         source / 'CodexControl.xcodeproj/xcshareddata/xcschemes/CodexControl.xcscheme', source / 'README.md']
with ZipFile(archive, 'w', ZIP_DEFLATED) as output:
    for file in sorted(files):
        output.write(file, 'Codex-Control-iOS/' + file.relative_to(source).as_posix())
with ZipFile(archive) as output:
    assert output.testzip() is None
    for file in files:
        assert output.read('Codex-Control-iOS/' + file.relative_to(source).as_posix()) == file.read_bytes()
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size,
                 'files': len(files), 'structuralChecks': True, 'xcodeBuild': False}))
