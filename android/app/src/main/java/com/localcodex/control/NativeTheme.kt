package com.localcodex.control

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Immutable internal data class NativeThemePalette(
    val primary:Color,val background:Color,val surface:Color,val ink:Color,val onPrimary:Color,
    val wash:Color,val bubble:Color,val chat:Color,val gradientStart:Color,val gradientEnd:Color,
){
    fun material(dark:Boolean):Colors=if(dark)darkColors(primary=primary,secondary=primary,background=background,surface=surface,
        onPrimary=onPrimary,onSecondary=onPrimary,onSurface=ink,onBackground=ink)
    else lightColors(primary=primary,secondary=primary,background=background,surface=surface,
        onPrimary=onPrimary,onSecondary=onPrimary,onSurface=ink,onBackground=ink)
}
@Immutable internal data class NativeThemeGeometry(
    val control:Float=12f,val card:Float=18f,val panel:Float=28f,
    val button:Float=12f,val field:Float=12f,val menuItem:Float=12f,
)
@Immutable internal data class NativeThemeMaterial(
    val overlayLight:Float=.56f,val overlayDark:Float=.50f,
    val insetLight:Float=.24f,val insetDark:Float=.18f,
    val panelLight:Float=.24f,val panelDark:Float=.32f,
    val dockLight:Float=.36f,val dockDark:Float=.44f,
    val blurDp:Float=6f,val overlayBlurDp:Float=20f,val edgeDp:Float=.75f,val shadowDp:Float=8f,val edgeFadeDp:Float=0f,val edgeFadeMinAlpha:Float=.40f,
    val sidebarFadeDp:Float=64f,
){
    fun opacity(kind:NativeGlassKind,light:Boolean):Float=when(kind){
        NativeGlassKind.MENU,NativeGlassKind.SHEET->if(light)overlayLight else overlayDark
        NativeGlassKind.INSET->if(light)insetLight else insetDark
        NativeGlassKind.DOCK->if(light)dockLight else dockDark
        else->if(light)panelLight else panelDark
    }
}
@Immutable internal data class NativeThemeDefinition(
    val id:String,val name:String,val mode:NativeGlassMode,val light:NativeThemePalette,val dark:NativeThemePalette,
    val geometry:NativeThemeGeometry=NativeThemeGeometry(),val material:NativeThemeMaterial=NativeThemeMaterial(),
){
    fun resolve(darkMode:Boolean)=NativeResolvedTheme(this,if(darkMode)dark else light,darkMode)
}
@Immutable internal data class NativeResolvedTheme(val definition:NativeThemeDefinition,val palette:NativeThemePalette,val dark:Boolean){
    val geometry get()=definition.geometry
    val material get()=definition.material
    val floating get()=definition.mode.floatingChrome
}

internal object NativeBuiltinThemes {
    private val light=NativeThemePalette(AppColor.LightPrimary,AppColor.LightBackground,AppColor.LightSurface,AppColor.LightOnSurface,
        Color.White,AppColor.WashLight,AppColor.BubbleLight,AppColor.ChatLight,Color(0xfffafafa),Color(0xfff5f5f5))
    private val dark=NativeThemePalette(AppColor.DarkPrimary,AppColor.DarkBackground,AppColor.DarkSurface,AppColor.DarkOnSurface,
        AppColor.DarkBackground,AppColor.WashDark,AppColor.BubbleDark,AppColor.ChatDark,Color.Black,Color.Black)
    val standard=NativeThemeDefinition("off","标准",NativeGlassMode.OFF,light,dark)
    val liquid=standard.copy(id="liquid",name="液态玻璃",mode=NativeGlassMode.LIQUID,
        light=NativeThemePalette(Color(0xff3566ef),Color(0xfff7f7f7),Color.White,Color(0xff0d0d0d),Color.White,
            Color.White,Color(0xffecf2fe),Color(0xfffcfcfc),Color(0xfffafafa),Color(0xfff5f5f5)),
        dark=NativeThemePalette(Color(0xff93b7f5),Color.Black,Color(0xff151515),Color(0xfff1f1f1),Color.Black,
            Color(0xff202020),Color(0xff252525),Color.Black,Color.Black,Color.Black),
        geometry=NativeThemeGeometry(control=18f,card=20f,panel=28f,button=24f,field=16f,menuItem=16f),material=NativeThemeMaterial(edgeFadeDp=28f))
    val lightweight=liquid.copy(id="light",name="液态轻量",mode=NativeGlassMode.LIGHT,
        material=liquid.material.copy(overlayLight=.94f,overlayDark=.94f,insetLight=.64f,insetDark=.64f,
            panelLight=.92f,panelDark=.92f,dockLight=.94f,dockDark=.94f,blurDp=0f,overlayBlurDp=0f,shadowDp=0f))
    val all=listOf(standard,lightweight,liquid)
    fun base(id:String)=all.firstOrNull{it.id==if(id=="soft")"light" else id}?:throw IllegalArgumentException("主题基底无效")
}
internal val LocalNativeTheme=staticCompositionLocalOf{NativeBuiltinThemes.standard.resolve(false)}

@Composable internal fun NativeThemeProvider(theme:NativeResolvedTheme,colors:Colors,content:@Composable ()->Unit){
    val geometry=theme.geometry
    val selection=remember(theme.dark){
        val blue=if(theme.dark)AppColor.AccentDark else AppColor.AccentLight
        TextSelectionColors(blue,blue.copy(alpha=if(theme.dark).32f else .24f))
    }
    CompositionLocalProvider(LocalNativeTheme provides theme){
        MaterialTheme(colors=colors,shapes=Shapes(RoundedCornerShape(geometry.button.dp),RoundedCornerShape(geometry.panel.dp),RoundedCornerShape(geometry.panel.dp))){
            CompositionLocalProvider(LocalTextSelectionColors provides selection,content=content)
        }
    }
}

/** Neutral cards share the active material; full pages and semantic colors keep their role. */
@Composable internal fun NativeThemeSurface(
    modifier:Modifier=Modifier,shape:Shape=RectangleShape,color:Color=MaterialTheme.colors.surface,
    contentColor:Color=contentColorFor(color),border:BorderStroke?=null,elevation:Dp=0.dp,content:@Composable ()->Unit,
){
    val theme=LocalNativeTheme.current
    val card=theme.floating&&shape!=RectangleShape&&(color==MaterialTheme.colors.surface||color==theme.palette.wash)
    if(card)CompositionLocalProvider(LocalContentColor provides contentColor){
        NativeGlassSurface(modifier,shape,color,border,kind=NativeGlassKind.INSET,content=content)
    }else Surface(modifier,shape,color,contentColor,border,elevation,content)
}

/** Theme files contain data only; geometry and GPU work remain bounded by renderer capabilities. */
internal object NativeThemeCodec {
    const val maxBytes=64*1024
    fun decode(text:String,builtIn:Boolean=false):NativeThemeDefinition {
        require(text.toByteArray(Charsets.UTF_8).size<=maxBytes){"主题文件不能超过 64 KB"}
        val root=JSONObject(text)
        require(root.getInt("version")==1){"不支持的主题文件版本"}
        val id=root.getString("id")
        require(id.matches(Regex("[a-z0-9][a-z0-9_-]{0,47}"))){"主题 ID 需为小写字母、数字或短横线"}
        val name=root.getString("name").trim()
        require(name.isNotEmpty()&&name.length<=48){"主题名称需为 1–48 个字"}
        val base=NativeBuiltinThemes.base(root.getString("base"))
        fun palette(key:String,default:NativeThemePalette):NativeThemePalette {
            val data=root.optJSONObject("colors")?.optJSONObject(key)?:return default
            fun color(key:String,fallback:Color):Color {
                if(!data.has(key))return fallback
                val value=data.getString(key)
                require(value.matches(Regex("#[0-9a-fA-F]{6}"))){"颜色 $key 需为 #RRGGBB"}
                return Color(android.graphics.Color.parseColor(value))
            }
            return NativeThemePalette(color("primary",default.primary),color("background",default.background),color("surface",default.surface),
                color("ink",default.ink),color("onPrimary",default.onPrimary),color("wash",default.wash),color("bubble",default.bubble),
                color("chat",default.chat),color("gradientStart",default.gradientStart),color("gradientEnd",default.gradientEnd))
        }
        fun number(data:JSONObject?,key:String,fallback:Float,range:ClosedFloatingPointRange<Float>):Float {
            if(data?.has(key)!=true)return fallback
            val value=data.getDouble(key).toFloat()
            require(value.isFinite()&&value in range){"主题参数 $key 超出范围"}
            return value
        }
        val g=root.optJSONObject("geometry");val old=base.geometry
        val geometry=NativeThemeGeometry(number(g,"control",old.control,4f..40f),number(g,"card",old.card,4f..48f),
            number(g,"panel",old.panel,8f..60f),number(g,"button",old.button,4f..40f),number(g,"field",old.field,4f..40f),number(g,"menuItem",old.menuItem,4f..40f))
        val m=root.optJSONObject("material");val material=base.material
        fun opacity(key:String,fallback:Float)=number(m,key,fallback,.05f..1f)
        return base.copy(id=if(builtIn)id else "custom:$id",name=name,light=palette("light",base.light),dark=palette("dark",base.dark),geometry=geometry,
            material=NativeThemeMaterial(opacity("overlayLight",material.overlayLight),opacity("overlayDark",material.overlayDark),
                opacity("insetLight",material.insetLight),opacity("insetDark",material.insetDark),opacity("panelLight",material.panelLight),opacity("panelDark",material.panelDark),
                opacity("dockLight",material.dockLight),opacity("dockDark",material.dockDark),number(m,"blurDp",material.blurDp,0f..32f),
                number(m,"overlayBlurDp",material.overlayBlurDp,0f..40f),number(m,"edgeDp",material.edgeDp,.25f..2f),number(m,"shadowDp",material.shadowDp,0f..16f),
                number(m,"edgeFadeDp",material.edgeFadeDp,0f..64f),number(m,"edgeFadeMinAlpha",material.edgeFadeMinAlpha,0f..1f),
                number(m,"sidebarFadeDp",material.sidebarFadeDp,0f..128f)))
    }
    fun encode(theme:NativeThemeDefinition):String {
        fun color(value:Color)="#"+Integer.toHexString(value.toArgb()).takeLast(6).padStart(6,'0')
        fun palette(p:NativeThemePalette)=JSONObject().put("primary",color(p.primary)).put("background",color(p.background)).put("surface",color(p.surface))
            .put("ink",color(p.ink)).put("onPrimary",color(p.onPrimary)).put("wash",color(p.wash)).put("bubble",color(p.bubble))
            .put("chat",color(p.chat)).put("gradientStart",color(p.gradientStart)).put("gradientEnd",color(p.gradientEnd))
        val g=theme.geometry;val m=theme.material
        return JSONObject().put("version",1).put("id",theme.id.removePrefix("custom:").let{if(theme.id.startsWith("custom:"))it else "$it-custom"})
            .put("name",theme.name).put("base",theme.mode.stored).put("colors",JSONObject().put("light",palette(theme.light)).put("dark",palette(theme.dark)))
            .put("geometry",JSONObject().put("control",g.control).put("card",g.card).put("panel",g.panel).put("button",g.button).put("field",g.field).put("menuItem",g.menuItem))
            .put("material",JSONObject().put("overlayLight",m.overlayLight).put("overlayDark",m.overlayDark).put("insetLight",m.insetLight).put("insetDark",m.insetDark)
                .put("panelLight",m.panelLight).put("panelDark",m.panelDark).put("dockLight",m.dockLight).put("dockDark",m.dockDark)
                .put("blurDp",m.blurDp).put("overlayBlurDp",m.overlayBlurDp).put("edgeDp",m.edgeDp).put("shadowDp",m.shadowDp).put("edgeFadeDp",m.edgeFadeDp).put("edgeFadeMinAlpha",m.edgeFadeMinAlpha).put("sidebarFadeDp",m.sidebarFadeDp)).toString(2)
    }
}
