If WScript.Arguments.Count <> 2 Then WScript.Quit 2

Set shell = CreateObject("WScript.Shell")
command = """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """"
WScript.Quit shell.Run(command, 0, True)
