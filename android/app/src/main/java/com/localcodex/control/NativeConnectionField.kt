package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.Text
import androidx.compose.material.MaterialTheme
import androidx.compose.material.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeConnectionField(
    value:String,
    change:(String)->Unit,
    label:String,
    modifier:Modifier=Modifier,
    keyboardType:KeyboardType=KeyboardType.Ascii,
    secret:Boolean=false,
    imeAction:ImeAction=ImeAction.Next,
){
    var revealed by remember{mutableStateOf(false)}
    Column(modifier.fillMaxWidth()){
        Text(label,color=MaterialTheme.colors.onSurface.copy(alpha=0.64f),fontSize=12.sp,modifier=Modifier.padding(bottom=6.dp))
        Row(Modifier.fillMaxWidth().clip(Radius.Field).background(LocalNativeTheme.current.palette.wash).padding(start=14.dp,end=if(secret)4.dp else 14.dp),verticalAlignment=Alignment.CenterVertically){
            BasicTextField(
                value=value,onValueChange=change,singleLine=true,
                textStyle=TextStyle(color=MaterialTheme.colors.onSurface,fontSize=16.sp),
                keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else keyboardType,autoCorrect=false,imeAction=imeAction),
                visualTransformation=if(secret&&!revealed)PasswordVisualTransformation() else VisualTransformation.None,
                modifier=Modifier.weight(1f).padding(vertical=14.dp).semantics{contentDescription=label},
            )
            if(secret)TextButton(onClick={revealed=!revealed}){Text(if(revealed)"隐藏密码" else "显示密码")}
        }
    }
}
