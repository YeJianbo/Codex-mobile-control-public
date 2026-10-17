from pathlib import Path
import xml.etree.ElementTree as ET
import re

root=Path(__file__).resolve().parent.parent
public=root/'server/public'
drawable=root/'android/app/src/main/res/drawable'
raw=root/'android/app/src/main/res/raw'
hermes=ET.parse(root/'artifacts/hermes-official-logo.svg').getroot()
hp=next(e for e in hermes.iter() if e.tag.endswith('path'))
deepseek=ET.parse(root/'artifacts/deepseek-official-logo.svg').getroot()
dp=[e for e in deepseek if e.tag.endswith('path')][-1]
definitions={
 'hermes':(5487.0615,hp.attrib['d'],(1.0330354,-145.41428,-2499.328)),
 'deepseek':(60,dp.attrib['d'],(1,2,9.32)),
}
for name,(viewport,data,(scale,tx,ty)) in definitions.items():
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {viewport} {viewport}"><path fill="currentColor" transform="matrix({scale},0,0,{scale},{tx},{ty})" d="{data}"/></svg>'
 (public/f'harness-{name}.svg').write_text(svg,encoding='utf-8')
 if name=='hermes':
  # AAPT replaces oversized XML strings with STRING_TOO_LARGE. Keep the
  # compound path intact so its holes retain the official nonzero fill.
  raw.mkdir(parents=True,exist_ok=True)
  (raw/'harness_hermes_path.txt').write_text(data,encoding='utf-8')
  (drawable/'harness_hermes.xml').unlink(missing_ok=True)
  continue
 vector=f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="{viewport}" android:viewportHeight="{viewport}"><group android:scaleX="{scale}" android:scaleY="{scale}" android:translateX="{tx}" android:translateY="{ty}"><path android:fillColor="#FF000000" android:pathData="{data}"/></group></vector>\n'
 (drawable/f'harness_{name}.xml').write_text(vector,encoding='utf-8')
cssfile=public/'console.css'
css=cssfile.read_text(encoding='utf-8')
for name in definitions:
 css,n=re.subn(r"\.harness-mark\[data-harness='"+name+r"'\] \{[^\n]+\}",".harness-mark[data-harness='"+name+"'] {--harness-icon:url('harness-"+name+".svg');}",css)
 assert n==1,(name,n)
css=css.replace('.welcome-mark .harness-brand-mark { width:36px; height:36px; }','.welcome-mark .harness-brand-mark { width:48px; height:48px; }')
cssfile.write_text(css,encoding='utf-8')
(root/'docs/harness-icons.md').write_text('''# Harness 图标来源

Hermes 使用 [Nous Research 官方仓库](https://github.com/NousResearch/hermes-agent/blob/main/assets/nous-girl-black.svg)中的 Nous Girl 标志；DeepSeek 使用 [官方仓库](https://github.com/deepseek-ai/DeepSeek-LLM/blob/main/images/logo.svg)中鲸鱼图形，去除文字。

网页 SVG 和 Android 图标保留源路径及变换，颜色由当前主题决定。Hermes 的复合路径存入 raw 资源，由 Compose 构建矢量图，避免 AAPT 的 XML 字符串长度限制。其他 Harness 继续沿用已有素材。
''',encoding='utf-8')
print('Official Hermes and DeepSeek marks converted to web SVG and Android vectors.')
