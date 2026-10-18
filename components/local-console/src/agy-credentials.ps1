$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AgyCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Credential {
    public uint Flags, Type;
    public string TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist, AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias, UserName;
  }
  [DllImport("advapi32", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ReadNative(string target,uint type,uint flags,out IntPtr value);
  [DllImport("advapi32", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool WriteNative(ref Credential value,uint flags);
  [DllImport("advapi32", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool DeleteNative(string target,uint type,uint flags);
  [DllImport("advapi32")] static extern void CredFree(IntPtr value);
  public static string Read() {
    IntPtr value;
    if(!ReadNative("gemini:antigravity",1,0,out value)) {
      if(Marshal.GetLastWin32Error()==1168) return null;
      throw new InvalidOperationException("credential read failed");
    }
    try {
      Credential cred=(Credential)Marshal.PtrToStructure(value,typeof(Credential));
      if(cred.CredentialBlobSize>65536) throw new InvalidOperationException();
      byte[] bytes=new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob,bytes,0,bytes.Length);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(value); }
  }
  public static void Write(string payload) {
    byte[] bytes=Encoding.UTF8.GetBytes(payload);
    IntPtr blob=Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes,0,blob,bytes.Length);
      Credential cred=new Credential {Type=1,TargetName="gemini:antigravity",UserName="antigravity",CredentialBlobSize=(uint)bytes.Length,CredentialBlob=blob,Persist=2};
      if(!WriteNative(ref cred,0)) throw new InvalidOperationException("credential write failed");
    } finally { Marshal.FreeHGlobal(blob); }
  }
  public static void Clear() {
    if(!DeleteNative("gemini:antigravity",1,0) && Marshal.GetLastWin32Error()!=1168) throw new InvalidOperationException("credential delete failed");
  }
}
'@
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  switch ($request.action) {
    'read' { $value = [AgyCredential]::Read(); @{payload=$value} | ConvertTo-Json -Compress }
    'write' { [AgyCredential]::Write([string]$request.payload); if ([AgyCredential]::Read() -cne [string]$request.payload) { throw 'verification failed' }; '{"ok":true}' }
    'clear' { [AgyCredential]::Clear(); '{"ok":true}' }
    default { throw 'unsupported operation' }
  }
} catch { [Console]::Error.Write('AGY credential operation failed'); exit 1 }
