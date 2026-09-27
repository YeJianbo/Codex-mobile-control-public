using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;

class DesktopCliShim {
    static System.Threading.Tasks.Task Pump(Stream source, Stream target, bool close) {
        return System.Threading.Tasks.Task.Run(() => {
            try {
                var buffer = new byte[8192];
                int count;
                while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
                    target.Write(buffer, 0, count); target.Flush();
                }
            } catch (IOException) {} finally { if (close) target.Close(); }
        });
    }
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string configPath = Path.Combine(root, "config.json");
            var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            var command = new StringBuilder(Quote((string)config["bridgeScript"]) + " " + Quote(configPath));
            foreach (string arg in args) command.Append(" " + Quote(arg));
            var info = new ProcessStartInfo((string)config["node"], command.ToString());
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (var process = Process.Start(info)) {
                var input = Pump(Console.OpenStandardInput(), process.StandardInput.BaseStream, true);
                var output = Pump(process.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
                var error = Pump(process.StandardError.BaseStream, Console.OpenStandardError(), false);
                process.WaitForExit();
                System.Threading.Tasks.Task.WaitAll(output, error);
                return process.ExitCode;
            }
        } catch (Exception error) { Console.Error.WriteLine("Desktop bridge: " + error.Message); return 1; }
    }
}
