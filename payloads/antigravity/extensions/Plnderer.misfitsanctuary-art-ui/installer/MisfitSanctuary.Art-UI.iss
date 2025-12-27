[Setup]
AppId=66A26D8E-7D29-4F6E-8D7C-2B9E5C7F7D1A
AppName=MisfitSanctuary.Art UI
AppVersion=0.1.0
AppPublisher=Plnderer
DefaultDirName={userappdata}\MisfitSanctuary.Art-UI
DisableProgramGroupPage=yes
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
WizardStyle=modern
OutputBaseFilename=MisfitSanctuary.Art-UI-Setup
OutputDir=.

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "installer\*"

[Run]
Filename: "{cmd}"; Parameters: "/C powershell -ExecutionPolicy Bypass -File ""{app}\scripts\apply.ps1"" -Preset Full"; StatusMsg: "Applying MisfitSanctuary.Art UI patches..."; Flags: runhidden waituntilterminated
