package com.localcodex.control

import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.*
import org.commonmark.parser.Parser

private val tableParser=Parser.builder().extensions(listOf(TablesExtension.create())).build()
private val tableLineBreak=Regex("<br\\s*/?>",RegexOption.IGNORE_CASE)

/** Use the same GFM grammar as the Markdown renderer, including escaped pipes. */
internal fun nativeTableRows(source:String):List<List<String>>{
    val rows=mutableListOf<List<String>>()
    tableParser.parse(source).accept(object:AbstractVisitor(){
        override fun visit(node:CustomNode){
            if(node !is TableRow){visitChildren(node);return}
            val cells=mutableListOf<String>()
            var cell=node.firstChild
            while(cell!=null){
                if(cell is TableCell){
                    val content=StringBuilder()
                    cell.accept(object:AbstractVisitor(){
                        override fun visit(node:Text){content.append(node.literal)}
                        override fun visit(node:Code){content.append(node.literal)}
                        override fun visit(node:SoftLineBreak){content.append('\n')}
                        override fun visit(node:HardLineBreak){content.append('\n')}
                        override fun visit(node:HtmlInline){
                            if(tableLineBreak.matches(node.literal))content.append('\n')
                        }
                    })
                    cells.add(content.toString().trim())
                }
                cell=cell.next
            }
            rows.add(cells)
        }
    })
    return rows
}

internal fun nativeTableTsv(rows:List<List<String>>):String=rows.joinToString("\n"){row->
    row.joinToString("\t"){cell->cell.replace('\t',' ').replace('\n',' ').replace('\r',' ')}
}
