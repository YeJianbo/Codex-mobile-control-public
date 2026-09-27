Option Explicit

Function Quoted(value)
    Quoted = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

If WScript.Arguments.Count <> 3 Then WScript.Quit 2

Dim service, executable, target, command, shell
service = WScript.Arguments(0)
executable = WScript.Arguments(1)
target = WScript.Arguments(2)

Select Case service
    Case "public-entry"
        command = Quoted(executable) & " " & Quoted(target)
    Case "tunnel"
        command = Quoted(executable) & " --config " & Quoted(target) & " tunnel run"
    Case Else
        WScript.Quit 2
End Select

Set shell = CreateObject("WScript.Shell")
WScript.Quit shell.Run(command, 0, True)
