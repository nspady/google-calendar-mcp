param(
    [Parameter(Mandatory = $true)]
    [string] $Path
)

$ErrorActionPreference = 'Stop'
$directory = Get-Item -LiteralPath $Path
if (-not $directory.PSIsContainer -or
    ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'The token directory must be an existing directory, not a link or reparse point.'
}

# Restrict only the named directory. New token files inherit this ACL.
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
foreach ($sid in @($user, $system, $administrators)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance, [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $directory.FullName -AclObject $acl
$actual = Get-Acl -LiteralPath $directory.FullName
if (-not $actual.AreAccessRulesProtected -or $actual.Access.Count -ne 3) {
    throw 'Token directory ACL verification failed.'
}
Write-Output 'Token directory access restricted to the current user, SYSTEM and Administrators.'
