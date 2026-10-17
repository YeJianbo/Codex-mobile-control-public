using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Collections.Generic;

[assembly: AssemblyTitle("Codex Control")]
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.6.2",FrameworkDisplayName=".NET Framework 4.6.2")]

static class Program {
 public static string Root=AppDomain.CurrentDomain.BaseDirectory;
 public static JavaScriptSerializer Json=new JavaScriptSerializer();
 public static string Quote(string value){var b=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}b.Append('\\',c=='"'?n*2+1:n);b.Append(c);n=0;}b.Append('\\',n*2);return b.Append('"').ToString();}
 public static string Run(string exe,string args,string input=null){
  var p=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
  using(var child=Process.Start(p)){
   var output=new StringBuilder();var error=new StringBuilder();var outputClosed=new TaskCompletionSource<bool>();var errorClosed=new TaskCompletionSource<bool>();
   child.OutputDataReceived+=(s,e)=>{if(e.Data==null)outputClosed.TrySetResult(true);else lock(output)output.AppendLine(e.Data);};
   child.ErrorDataReceived+=(s,e)=>{if(e.Data==null)errorClosed.TrySetResult(true);else lock(error)error.AppendLine(e.Data);};
   child.BeginOutputReadLine();child.BeginErrorReadLine();
   if(input!=null)child.StandardInput.Write(input);child.StandardInput.Close();
   if(!child.WaitForExit(300000)){child.Kill();throw new Exception("操作超时，请查看安装或后台日志");}
   // A detached guard can inherit a pipe handle after PowerShell exits. Wait
   // for the direct child, then bound draining rather than waiting for EOF.
   Task.WaitAll(new Task[]{outputClosed.Task,errorClosed.Task},1000);
   try{child.CancelOutputRead();child.CancelErrorRead();}catch(InvalidOperationException){}
   string text,errors;lock(output)text=output.ToString();lock(error)errors=error.ToString();
   if(child.ExitCode!=0)throw new Exception(errors+text);return text;
  }
 }
 public static string PowerShell(string script,string args=""){return Run(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell/v1.0/powershell.exe"),"-NoProfile -ExecutionPolicy Bypass -File "+Quote(script)+" "+args);}
 public static Dictionary<string,object> Node(string command,string arg=null,string input=null){return Json.Deserialize<Dictionary<string,object>>(Run(Path.Combine(Root,"runtime/node.exe"),Quote(Path.Combine(Root,"installer/instance.mjs"))+" "+command+(arg==null?"":" "+Quote(arg)),input));}
 static string FileSystemPath(string absolute){
  // Extended paths reach Unicode file APIs without depending on a global policy.
  if(absolute.StartsWith(@"\\?\",StringComparison.Ordinal))return absolute;
  return absolute.StartsWith(@"\\",StringComparison.Ordinal)?@"\\?\UNC\"+absolute.Substring(2):@"\\?\"+absolute;
 }
 public static string Extract(string destination){destination=Path.GetFullPath(destination);Directory.CreateDirectory(FileSystemPath(destination));string absolute=destination+Path.DirectorySeparatorChar;using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")){if(resource==null)throw new Exception("安装载荷不存在");using(var zip=new ZipArchive(resource,ZipArchiveMode.Read)){foreach(var entry in zip.Entries){string target=Path.GetFullPath(Path.Combine(destination,entry.FullName));if(!target.StartsWith(absolute,StringComparison.OrdinalIgnoreCase))throw new Exception("安装包路径无效");if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(FileSystemPath(target));continue;}Directory.CreateDirectory(FileSystemPath(Path.GetDirectoryName(target)));using(var source=entry.Open())using(var output=File.Create(FileSystemPath(target)))source.CopyTo(output);}}}return Path.Combine(destination,"local-console");}
 public static void InstallPackage(string options){
  string temporaryRoot=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"."));
  string temporary=Path.Combine(temporaryRoot,"CodexControlSetup-"+Guid.NewGuid().ToString("N"));
  try{
   string source=Extract(temporary);
   string result=PowerShell(Path.Combine(source,"installer/Install.ps1"),options);
   File.WriteAllText(Path.Combine(temporaryRoot,"CodexControl-last-install.log"),result);
  }finally{
   // Only the uniquely created extraction directory is disposable. Explicit
   // /extract destinations and the installed program/data are retained.
   if(!String.Equals(Path.GetDirectoryName(Path.GetFullPath(temporary)),temporaryRoot,StringComparison.OrdinalIgnoreCase))throw new IOException("安装临时目录路径无效");
   try{if(Directory.Exists(FileSystemPath(temporary)))Directory.Delete(FileSystemPath(temporary),true);}
   catch(IOException error){File.WriteAllText(Path.Combine(temporaryRoot,"CodexControl-last-cleanup.log"),temporary+Environment.NewLine+error.Message);}
   catch(UnauthorizedAccessException error){File.WriteAllText(Path.Combine(temporaryRoot,"CodexControl-last-cleanup.log"),temporary+Environment.NewLine+error.Message);}
  }
 }
 [STAThread] static int Main(string[] args){
  try {
   bool setup=Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("payload.zip");
   if(setup&&args.Length==2&&args[0]=="/extract"){Extract(args[1]);return 0;}
   if(setup&&args.Contains("/silent")){
    var forwarded=args.Where(a=>a!="/silent").Select(Quote);
    InstallPackage(String.Join(" ",forwarded));
    return 0;
   }
   if(!setup&&args.Length==2&&args[0]=="/check"){File.WriteAllText(args[1],Json.Serialize(Node("dashboard")));return 0;}
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   if(!setup&&args.Length==2&&args[0]=="/render"){
    var manager=new ManagerForm{Opacity=0,ShowInTaskbar=false};var timer=new Timer{Interval=500};int attempts=0;
    timer.Tick+=(s,e)=>{if(manager.Ready){using(var bitmap=new Bitmap(manager.Width,manager.Height)){manager.DrawToBitmap(bitmap,new Rectangle(0,0,manager.Width,manager.Height));bitmap.Save(args[1]);}timer.Stop();manager.Close();}else if(++attempts>120){timer.Stop();manager.Close();}};timer.Start();Application.Run(manager);timer.Dispose();return File.Exists(args[1])?0:1;
   }
   Application.Run(setup?(Form)new InstallerForm():(Form)new ManagerForm());return 0;
  }catch(Exception e){File.WriteAllText(Path.Combine(Path.GetTempPath(),"CodexControl-last-error.log"),e.ToString());if(!args.Contains("/silent")&&!args.Contains("/extract")&&!args.Contains("/check"))MessageBox.Show(e.Message,"Codex Control",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
 }
}

class InstallerForm:Form {
 TextBox location;Button install;Label status;CheckBox startup,bridge;
 public InstallerForm(){Text="Codex Control "+Assembly.GetExecutingAssembly().GetName().Version.ToString(3)+" — 安装";ClientSize=new Size(570,320);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft YaHei UI",10);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
  var title=new Label{Text="Codex Control",Font=new Font(Font.FontFamily,19,FontStyle.Bold),Bounds=new Rectangle(24,20,500,42)};
  var description=new Label{Text="电脑管理后台与手机绑定二维码",Bounds=new Rectangle(26,67,510,28)};
  location=new TextBox{Text=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".codex/tools/local-console"),Bounds=new Rectangle(26,114,518,30)};
  startup=new CheckBox{Text="登录 Windows 后在后台启动",Checked=true,Bounds=new Rectangle(26,156,510,26)};
  bridge=new CheckBox{Text="与已安装的 Codex 桌面版共享会话",Checked=true,Bounds=new Rectangle(26,190,510,26)};
  status=new Label{Text="安装后直接打开手机绑定界面。",Bounds=new Rectangle(26,235,510,28)};
  install=new Button{Text="安装",Bounds=new Rectangle(420,275,124,32)};install.Click+=async (s,e)=>await Install();Controls.AddRange(new Control[]{title,description,location,startup,bridge,status,install});
 }
 async Task Install(){install.Enabled=false;location.Enabled=false;startup.Enabled=false;bridge.Enabled=false;try{
  string target=Path.GetFullPath(location.Text),options="-InstallDirectory "+Program.Quote(target)+(startup.Checked?"":" -NoAutostart")+(bridge.Checked?"":" -SkipDesktopBridge");status.Text="正在安装并启动后台…";
  await Task.Run(()=>Program.InstallPackage(options));
  status.Text="安装完成。桌面共享设置在重新打开 Codex 后生效。";
  Process.Start(new ProcessStartInfo(Path.Combine(target,"CodexControl.exe")){WorkingDirectory=target,UseShellExecute=true});Close();
 }catch(Exception e){status.Text="安装未完成";MessageBox.Show(e.Message,"安装失败",MessageBoxButtons.OK,MessageBoxIcon.Error);install.Enabled=true;location.Enabled=true;startup.Enabled=true;bridge.Enabled=true;}}
}

class ManagerForm:Form {
 public bool Ready=false;
 PictureBox qr;Label state,code;ComboBox address;TextBox password,domain;Button refresh,save,backend;bool busy=false;Timer timer;
 public ManagerForm(){Text="Codex Control — 手机绑定与管理";ClientSize=new Size(660,620);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft YaHei UI",10);MinimumSize=Size;MaximumSize=Size;
  var title=new Label{Text="绑定手机",Font=new Font(Font.FontFamily,20,FontStyle.Bold),Bounds=new Rectangle(28,18,300,46)};
  state=new Label{Text="正在启动后台…",Bounds=new Rectangle(28,71,606,45)};
  qr=new PictureBox{Bounds=new Rectangle(26,124,310,310),SizeMode=PictureBoxSizeMode.Zoom,BackColor=Color.White};
  code=new Label{Bounds=new Rectangle(28,443,310,30),TextAlign=ContentAlignment.MiddleCenter,Font=new Font(Font.FontFamily,14,FontStyle.Bold)};
  var instructions=new Label{Text="手机安装应用后，\n打开“连接电脑”扫描二维码。\n\n新设备先在同一局域网绑定，\n再配置公网地址与授权密码。",Bounds=new Rectangle(364,126,270,126)};
  backend=new Button{Text="打开管理后台",Bounds=new Rectangle(364,272,270,34)};backend.Click+=async(s,e)=>await OpenBackend();
  var doc=new Button{Text="安装与公网配置文档",Bounds=new Rectangle(364,319,270,34)};doc.Click+=(s,e)=>Process.Start(new ProcessStartInfo("notepad.exe",Program.Quote(Path.Combine(Program.Root,"docs/安装使用说明.md"))){UseShellExecute=true});
  refresh=new Button{Text="刷新绑定二维码",Bounds=new Rectangle(364,366,270,34)};refresh.Click+=async(s,e)=>await RefreshBinding();
  address=new ComboBox{Bounds=new Rectangle(28,484,606,28),DropDownStyle=ComboBoxStyle.DropDownList};address.SelectedIndexChanged+=async(s,e)=>{if(!busy)await RefreshBinding(Convert.ToString(address.SelectedItem));};
  var label=new Label{Text="授权密码",Bounds=new Rectangle(28,525,82,27)};password=new TextBox{UseSystemPasswordChar=true,Bounds=new Rectangle(111,521,255,30)};
  save=new Button{Text="保存密码",Bounds=new Rectangle(525,521,109,31)};save.Click+=async(s,e)=>await SavePassword();
  var show=new CheckBox{Text="显示",Bounds=new Rectangle(378,524,70,28)};show.CheckedChanged+=(s,e)=>password.UseSystemPasswordChar=!show.Checked;
  domain=new TextBox{Bounds=new Rectangle(28,583,606,26)};
  Controls.AddRange(new Control[]{title,state,qr,code,instructions,backend,doc,refresh,address,label,password,show,save,domain});ClientSize=new Size(660,620);MinimumSize=Size;MaximumSize=Size;
  var domainLabel=new Label{Text="公网地址（可选，例如 https://phone.example.com）",Bounds=new Rectangle(28,553,606,25)};Controls.Add(domainLabel);
  Shown+=async(s,e)=>{try{await Task.Run(()=>Program.PowerShell(Path.Combine(Program.Root,"installer/Start-Services.ps1")));await RefreshBinding();}catch(Exception ex){state.Text="后台启动失败："+ex.Message;}};
  timer=new Timer{Interval=120000};timer.Tick+=async(s,e)=>await RefreshBinding(Convert.ToString(address.SelectedItem));timer.Start();FormClosed+=(s,e)=>timer.Dispose();
 }
 async Task RefreshBinding(string selected=null){if(busy)return;busy=true;refresh.Enabled=false;try{var data=await Task.Run(()=>Program.Node("dashboard",selected));state.Text="后台 "+data["version"]+" 已运行 · "+(Convert.ToBoolean(data["desktop"])?"Codex 已连接":"请重新打开 Codex 桌面版以启用共享");using(var stream=new MemoryStream(Convert.FromBase64String((string)data["qr"]))){var image=new Bitmap(Image.FromStream(stream));var old=qr.Image;qr.Image=image;if(old!=null)old.Dispose();}code.Text="配对码  "+data["code"];
   string current=(string)data["baseUrl"];address.Items.Clear();foreach(var row in (System.Collections.IEnumerable)data["addresses"]){var item=(Dictionary<string,object>)row;address.Items.Add(Convert.ToString(item["url"]));}if(!address.Items.Contains(current))address.Items.Add(current);address.SelectedItem=current;if(!domain.Focused)domain.Text=(string)data["publicUrl"];Ready=true;
  }catch(Exception e){state.Text="无法刷新绑定信息："+e.Message;}finally{busy=false;refresh.Enabled=true;}}
 async Task SavePassword(){save.Enabled=false;try{string input=Program.Json.Serialize(new{password=password.Text,publicUrl=domain.Text.Trim()});await Task.Run(()=>Program.Node("password",null,input));password.Clear();await RefreshBinding(Convert.ToString(address.SelectedItem));state.Text="授权密码已保存；手机公网连接请使用新密码。";}catch(Exception e){MessageBox.Show(e.Message,"密码未保存",MessageBoxButtons.OK,MessageBoxIcon.Warning);}finally{save.Enabled=true;}}
 async Task OpenBackend(){backend.Enabled=false;try{string chrome=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google/Chrome/Application/chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google/Chrome/Application/chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google/Chrome/Application/chrome.exe")}.FirstOrDefault(File.Exists);if(chrome==null)throw new Exception("请安装 Google Chrome 后打开管理后台；当前二维码和密码设置不依赖浏览器。");var data=await Task.Run(()=>Program.Node("browser"));string options="--no-first-run --no-default-browser-check "+Program.Quote("--user-data-dir="+(string)data["profile"])+" "+Program.Quote("--ignore-certificate-errors-spki-list="+(string)data["spki"])+" "+Program.Quote((string)data["url"]);Process.Start(new ProcessStartInfo(chrome,options){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message,"管理后台",MessageBoxButtons.OK,MessageBoxIcon.Information);}finally{backend.Enabled=true;}}
}
