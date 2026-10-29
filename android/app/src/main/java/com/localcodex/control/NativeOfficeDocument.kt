package com.localcodex.control

import android.util.Base64
import android.util.Xml
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.net.URI
import java.util.zip.ZipFile

data class NativeDocumentPage(val name:String,val html:String)
internal fun nativeIsOfficeFile(name:String)=name.substringAfterLast('.').lowercase() in setOf("docx","xlsx","pptx")
internal fun nativeIsTabularFile(name:String)=name.substringAfterLast('.').lowercase() in setOf("csv","tsv")
internal fun nativeIsHtmlFile(name:String)=name.substringAfterLast('.').lowercase() in setOf("html","htm")
internal fun nativeDocumentHtmlEscape(value:String)=value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;")

private class OfficeNode(val name:String,val attributes:Map<String,String>){
    val children=mutableListOf<OfficeNode>()
    val value=StringBuilder()
    fun child(name:String)=children.firstOrNull{it.name==name}
    fun all(name:String):Sequence<OfficeNode> = sequence{if(this@OfficeNode.name==name)yield(this@OfficeNode);for(child in children)yieldAll(child.all(name))}
    fun text():String=value.toString()+children.joinToString(""){it.text()}
    operator fun get(name:String)=attributes[name].orEmpty()
}

/** Reads ZIP entries in memory; never extracts an archive onto the filesystem. */
private class OfficeArchive(val zip:ZipFile){
    private var remaining=64*1024*1024
    fun bytes(path:String):ByteArray{
        val entry=zip.getEntry(path)?:error("文档中缺少 $path")
        val limit=minOf(remaining,8*1024*1024)
        val bytes=zip.getInputStream(entry).use{it.readBytesLimited(limit)}
        remaining-=bytes.size
        return bytes
    }
    fun xml(path:String):OfficeNode{
        val parser=Xml.newPullParser().apply{setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES,true);setInput(bytes(path).inputStream(),null)}
        val root=OfficeNode("root",emptyMap());val stack=mutableListOf(root);var count=0
        while(parser.eventType!=XmlPullParser.END_DOCUMENT){
            when(parser.eventType){
                XmlPullParser.DOCDECL->error("文档包含不支持的 XML 声明")
                XmlPullParser.START_TAG->{
                    check(++count<=200000){"文档内容过大，请保存后使用办公应用打开"}
                    check(stack.size<256){"文档结构过深，无法预览"}
                    val node=OfficeNode(parser.name,(0 until parser.attributeCount).associate{
                        val prefix=if(parser.getAttributeNamespace(it).endsWith("/relationships"))"r:" else ""
                        prefix+parser.getAttributeName(it) to parser.getAttributeValue(it)
                    })
                    stack.last().children.add(node);stack.add(node)
                }
                XmlPullParser.TEXT->stack.last().value.append(parser.text)
                XmlPullParser.END_TAG->stack.removeAt(stack.lastIndex)
            }
            parser.next()
        }
        return root.children.single()
    }
    fun relations(part:String):Map<String,String>{
        val path=part.substringBeforeLast('/')+"/_rels/"+part.substringAfterLast('/')+".rels"
        if(zip.getEntry(path)==null)return emptyMap()
        return xml(path).children.filter{it.name=="Relationship"}.associate{it["Id"] to if(it["TargetMode"]=="External")it["Target"] else URI(part).resolve(it["Target"]).normalize().path.removePrefix("/")}
    }
    fun image(path:String):String{
        if(zip.getEntry(path)==null)return ""
        var mime=when(path.substringAfterLast('.').lowercase()){"png"->"image/png";"jpg","jpeg"->"image/jpeg";"gif"->"image/gif";"webp"->"image/webp";else->return ""}
        var encoded=bytes(path)
        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
        BitmapFactory.decodeByteArray(encoded,0,encoded.size,bounds)
        var sample=1
        while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048||bounds.outWidth.toLong()/sample*(bounds.outHeight/sample)>2L*1024*1024)sample*=2
        if(sample>1){
            val bitmap=BitmapFactory.decodeByteArray(encoded,0,encoded.size,BitmapFactory.Options().apply{inSampleSize=sample})?:return ""
            try{
                val alpha=bitmap.hasAlpha();mime=if(alpha)"image/png" else "image/jpeg"
                encoded=java.io.ByteArrayOutputStream().use{output->bitmap.compress(if(alpha)Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,90,output);output.toByteArray()}
            }finally{bitmap.recycle()}
        }
        return "<img loading=\"lazy\" src=\"data:$mime;base64,${Base64.encodeToString(encoded,Base64.NO_WRAP)}\" alt=\"图片\">"
    }
}

private fun java.io.InputStream.readBytesLimited(limit:Int):ByteArray{
    val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
    while(true){val count=read(buffer);if(count<0)break;check(output.size()+count<=limit){"文档内容过大，请保存后使用办公应用打开"};output.write(buffer,0,count)}
    return output.toByteArray()
}

private fun officeParagraph(node:OfficeNode,archive:OfficeArchive,relations:Map<String,String>):String{
    fun inline(part:OfficeNode):String=when(part.name){
        "t"->nativeDocumentHtmlEscape(part.text())
        "tab"->"&emsp;"
        "br"->"<br>"
        "blip"->relations[part["r:embed"]]?.let{archive.image(it)}.orEmpty()
        "r"->{
            var text=part.children.filter{it.name!="rPr"}.joinToString(""){inline(it)}
            val properties=part.child("rPr")
            if(properties?.child("b")?.let{it["val"] !in listOf("0","false")}==true)text="<strong>$text</strong>"
            if(properties?.child("i")!=null&&properties.child("i")?.get("val") !in listOf("0","false"))text="<em>$text</em>"
            text
        }
        "hyperlink"->{
            val body=part.children.joinToString(""){inline(it)}
            val target=relations[part["r:id"]].orEmpty()
            if(target.startsWith("https://")||target.startsWith("http://"))"<a href=\"${nativeDocumentHtmlEscape(target)}\">$body</a>" else body
        }
        else->part.children.joinToString(""){inline(it)}
    }
    val style=node.child("pPr")?.child("pStyle")?.get("val").orEmpty()
    val heading=Regex("(?i)heading([1-6])").matchEntire(style)?.groupValues?.get(1)
    val tag=heading?.let{"h$it"}?:"p"
    val align=node.child("pPr")?.child("jc")?.get("val")?.takeIf{it in setOf("center","right","justify")}
    val bullet=if(node.child("pPr")?.child("numPr")!=null)"• " else ""
    return "<$tag${align?.let{" style=\"text-align:$it\""}.orEmpty()}>$bullet${inline(node).ifEmpty{"<br>"}}</$tag>"
}

private fun wordDocument(archive:OfficeArchive):List<NativeDocumentPage>{
    val part="word/document.xml";val relations=archive.relations(part)
    fun blocks(node:OfficeNode):String=when(node.name){
        "p"->officeParagraph(node,archive,relations)
        "tbl"->"<div class=\"table-scroll\"><table>"+node.children.filter{it.name=="tr"}.joinToString(""){row->
            "<tr>"+row.children.filter{it.name=="tc"}.joinToString(""){cell->
                val span=cell.child("tcPr")?.child("gridSpan")?.get("val")?.toIntOrNull()?.coerceIn(1,1000)?:1
                "<td colspan=\"$span\">${cell.children.joinToString(""){blocks(it)}}</td>"
            }+"</tr>"
        }+"</table></div>"
        "body"->node.children.joinToString(""){blocks(it)}
        else->""
    }
    return listOf(NativeDocumentPage("正文",blocks(checkNotNull(archive.xml(part).child("body")))))
}

internal fun nativeSpreadsheetColumn(index:Int):String{
    var value=index+1;var label=""
    while(value>0){value--;label=('A'+value%26)+label;value/=26}
    return label
}
private fun spreadsheetHtml(rows:List<List<String>>):String{
    val columns=rows.maxOfOrNull{it.size}?:0
    return "<div class=\"table-scroll sheet\"><table><thead><tr><th></th>"+(0 until columns).joinToString(""){"<th>${nativeSpreadsheetColumn(it)}</th>"}+"</tr></thead><tbody>"+
        rows.mapIndexed{index,cells->"<tr><th>${index+1}</th>"+(0 until columns).joinToString(""){"<td>${nativeDocumentHtmlEscape(cells.getOrNull(it).orEmpty()).replace("\n","<br>")}</td>"}+"</tr>"}.joinToString("")+"</tbody></table></div>"
}
private fun workbookDocument(archive:OfficeArchive):List<NativeDocumentPage>{
    val part="xl/workbook.xml";val book=archive.xml(part);val relations=archive.relations(part)
    val strings=if(archive.zip.getEntry("xl/sharedStrings.xml")!=null)archive.xml("xl/sharedStrings.xml").all("si").map{it.all("t").joinToString(""){it.text()}}.toList()else emptyList()
    val styles=if(archive.zip.getEntry("xl/styles.xml")!=null)archive.xml("xl/styles.xml")else null
    val formats=styles?.all("numFmt")?.associate{it["numFmtId"] to it["formatCode"]}.orEmpty()
    val cellFormats=styles?.child("cellXfs")?.children?.map{it["numFmtId"]}.orEmpty()
    val date1904=book.child("workbookPr")?.get("date1904") in listOf("1","true")
    fun value(cell:OfficeNode):String{
        val raw=cell.child("v")?.text().orEmpty()
        return when(cell["t"]){
            "s"->strings.getOrNull(raw.toIntOrNull()?:-1).orEmpty()
            "inlineStr"->cell.all("t").joinToString(""){it.text()}
            "b"->if(raw=="1")"TRUE" else "FALSE"
            else->{
                val formatId=cellFormats.getOrNull(cell["s"].toIntOrNull()?:0).orEmpty()
                val format=formats[formatId].orEmpty().replace(Regex("\"[^\"]*\"|\\[[^]]*]|\\\\."),"")
                val date=(formatId.toIntOrNull()?:-1) in 14..22||Regex("[ydhs]",RegexOption.IGNORE_CASE).containsMatchIn(format)
                val number=raw.toDoubleOrNull()
                if(date&&number!=null){
                    val base=if(date1904)"1904-01-01" else if(number<60)"1899-12-31" else "1899-12-30"
                    val parser=java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT).apply{timeZone=java.util.TimeZone.getTimeZone("UTC")}
                    val pattern=if(formatId=="22"||Regex("h",RegexOption.IGNORE_CASE).containsMatchIn(format))"yyyy-MM-dd HH:mm" else "yyyy-MM-dd"
                    java.text.SimpleDateFormat(pattern,java.util.Locale.ROOT).apply{timeZone=parser.timeZone}.format(java.util.Date(checkNotNull(parser.parse(base)).time+(number*86400000).toLong()))
                }else if(number!=null&&format.contains('%'))java.text.DecimalFormat("0.##'%'").format(number*100)else raw
            }
        }
    }
    return book.all("sheet").map{sheet->
        val xml=archive.xml(checkNotNull(relations[sheet["r:id"]]))
        val rows=mutableListOf<List<String>>()
        for(row in xml.all("row")){
            val rowIndex=(row["r"].toIntOrNull()?:rows.size+1)-1
            check(rowIndex<10000){"表格超过 10000 行，请保存后使用表格应用打开"}
            while(rows.size<rowIndex)rows.add(emptyList())
            val cells=mutableListOf<String>()
            for(cell in row.children.filter{it.name=="c"}){
                var column=0
                for(char in cell["r"].takeWhile{it.isLetter()})column=column*26+(char.uppercaseChar()-'A'+1)
                val index=if(column==0)cells.size else column-1
                check(index<512){"表格超过 512 列，请保存后使用表格应用打开"}
                while(cells.size<=index)cells.add("")
                cells[index]=value(cell)
            }
            rows.add(cells)
        }
        check(rows.size.toLong()*(rows.maxOfOrNull{it.size}?:0)<=200000){"表格内容过大，请保存后使用表格应用打开"}
        NativeDocumentPage(sheet["name"],spreadsheetHtml(rows))
    }.toList()
}

private fun presentationDocument(archive:OfficeArchive):List<NativeDocumentPage>{
    val part="ppt/presentation.xml";val presentation=archive.xml(part);val relations=archive.relations(part)
    val size=presentation.child("sldSz");val width=size?.get("cx")?.toDoubleOrNull()?:9144000.0;val height=size?.get("cy")?.toDoubleOrNull()?:6858000.0
    return presentation.all("sldId").mapIndexed{index,slide->
        val path=checkNotNull(relations[slide["r:id"]]);val links=archive.relations(path);val xml=archive.xml(path)
        val shapes=xml.all("spTree").firstOrNull()?.children.orEmpty().joinToString(""){shape->
            val transform=shape.child("spPr")?.child("xfrm")
            val offset=transform?.child("off");val extent=transform?.child("ext")
            val style=if(offset!=null&&extent!=null)"position:absolute;left:${100*(offset["x"].toDoubleOrNull()?:0.0)/width}%;top:${100*(offset["y"].toDoubleOrNull()?:0.0)/height}%;width:${100*(extent["cx"].toDoubleOrNull()?:width)/width}%;height:${100*(extent["cy"].toDoubleOrNull()?:height)/height}%;" else ""
            val content=when(shape.name){
                "sp"->shape.child("txBody")?.children?.filter{it.name=="p"}?.joinToString(""){officeParagraph(it,archive,links)}.orEmpty()
                "pic"->shape.all("blip").firstOrNull()?.let{links[it["r:embed"]]?.let(archive::image)}.orEmpty()
                "graphicFrame"->shape.all("tbl").joinToString(""){table->"<table>"+table.children.filter{it.name=="tr"}.joinToString(""){row->"<tr>"+row.children.filter{it.name=="tc"}.joinToString(""){cell->"<td>"+cell.all("p").joinToString(""){officeParagraph(it,archive,links)}+"</td>"}+"</tr>"}+"</table>"}
                else->""
            }
            if(content.isEmpty())"" else "<div style=\"$style\">$content</div>"
        }
        NativeDocumentPage("${index+1}","<section class=\"slide\" style=\"aspect-ratio:$width/$height\">$shapes</section>")
    }.toList()
}

internal fun nativeReadOfficeDocument(file:File,name:String):List<NativeDocumentPage> = ZipFile(file).use{zip->
    val archive=OfficeArchive(zip)
    when(name.substringAfterLast('.').lowercase()){"docx"->wordDocument(archive);"xlsx"->workbookDocument(archive);"pptx"->presentationDocument(archive);else->error("不支持的文档格式")}
}

internal fun nativeDelimitedDocument(text:String,delimiter:Char):List<NativeDocumentPage>{
    val rows=mutableListOf<List<String>>();val cells=mutableListOf<String>();val cell=StringBuilder();var quoted=false;var index=0
    fun endCell(){cells.add(cell.toString());cell.setLength(0)}
    fun endRow(){endCell();rows.add(cells.toList());cells.clear();check(rows.size<=10000){"表格超过 10000 行，请保存后使用表格应用打开"}}
    while(index<text.length){
        val char=text[index++]
        when{
            char=='"'&&quoted&&index<text.length&&text[index]=='"'->{cell.append('"');index++}
            char=='"'&&(quoted||cell.isEmpty())->quoted=!quoted
            !quoted&&char==delimiter->endCell()
            !quoted&&(char=='\r'||char=='\n')->{if(char=='\r'&&index<text.length&&text[index]=='\n')index++;endRow()}
            else->cell.append(char)
        }
    }
    if(cell.isNotEmpty()||cells.isNotEmpty())endRow()
    check(rows.size.toLong()*(rows.maxOfOrNull{it.size}?:0)<=200000){"表格内容过大，请保存后使用表格应用打开"}
    return listOf(NativeDocumentPage("表格",spreadsheetHtml(rows)))
}
