package com.localcodex.control

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.DropdownMenu
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Management pickers share the same material and backdrop as chat menus. */
@Composable internal fun NativeDropdownMenu(
    expanded:Boolean,onDismissRequest:()->Unit,modifier:Modifier=Modifier,
    content:@Composable ColumnScope.()->Unit,
){
    if(!LocalNativeGlassMode.current.floatingChrome){
        DropdownMenu(expanded,onDismissRequest,modifier=modifier,content=content)
    }else{
        ModernDropdown(expanded,onDismissRequest,280.dp,placement=NativePopupPlacement.ADJACENT,modifier=modifier){
            Column(Modifier.padding(vertical=8.dp),content=content)
        }
    }
}
