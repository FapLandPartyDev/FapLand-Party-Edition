# Windows Vagrant Test Setup

This setup starts disposable Windows VMs for testing Fap Land with libvirt/QEMU.

## Host Prerequisites

- Vagrant installed
- QEMU/libvirt installed and running
- `vagrant-libvirt` installed and usable
- Your user can access libvirt without an interactive password prompt
- NFS server support enabled if using the default source mount

This repo's `nix develop` shell includes Vagrant, QEMU, and NFS utilities. The shell also defaults `VAGRANT_DEFAULT_PROVIDER=libvirt`.

The libvirt daemon, bridge, and permissions are host-level NixOS configuration. A typical host needs libvirtd enabled and your user in the libvirt group:

```nix
{
  virtualisation.libvirtd.enable = true;
  users.users.your-user.extraGroups = [ "libvirtd" ];
}
```

This pinned nixpkgs revision does not expose `vagrant-libvirt` as a top-level package, so install the plugin into your Vagrant home once:

```bash
vagrant plugin install vagrant-libvirt
```

The NixOS wiki notes that NFS synced folders need the host NFS server enabled and firewall access for the libvirt bridge. A minimal NixOS host module looks like:

```nix
{
  services.nfs.server.enable = true;

  networking.firewall.interfaces."virbr1" = {
    allowedTCPPorts = [ 2049 ];
    allowedUDPPorts = [ 2049 ];
  };
}
```

If your repo is under a home directory with restrictive parent permissions, the NFS export can fail with permission denied. The wiki documents `chmod a+x ~` as one workaround; apply that only if it fits your local security model.

## VMs

- `fapland-win-dev`: installs dependencies and creates a logon task that runs `npm run dev`.
- `fapland-win-prod`: installs dependencies, runs `npm run build:package`, extracts the portable Windows zip, and creates a logon task that runs `Fap Land.exe`.

Both VMs use WinRM for provisioning and RDP for the interactive desktop session.

## Commands

```bash
npm run vagrant:win:dev
npm run vagrant:win:prod
npm run vagrant:win:dev:rdp
npm run vagrant:win:prod:rdp
```

RDP credentials:

- Username: `vagrant`
- Password: `vagrant`

## Configuration

The default public box is `jborean93/WindowsServer2022`.

Override it with:

```bash
FLAND_WINDOWS_BOX=some/public-windows-box npm run vagrant:win:dev
```

Other supported overrides:

```bash
FLAND_VM_CPUS=4
FLAND_VM_MEMORY=8192
FLAND_WIN_PROJECT_DIR=C:/f-land
FLAND_WIN_NODE_VERSION=24.11.1
FLAND_WIN_DEV_PORT=3000
FLAND_WIN_REMOTE_DEBUGGING_PORT=9222
FLAND_VAGRANT_SYNC_TYPE=rsync
FLAND_VAGRANT_NFS_VERSION=4
```

The source tree is copied into Windows at `C:\f-land` by default. The Vagrantfile resolves the repo root explicitly and syncs that source path into the guest.

The default sync type is `rsync` because this is a Linux/NixOS host with a Windows guest. Vagrant documents SMB synced folders as supported only from Windows and macOS hosts, and NFS is primarily the NixOS path for Unix-like guests. If you use a Windows box that supports NFS client mounting, you can opt into NFS:

```bash
FLAND_VAGRANT_SYNC_TYPE=nfs npm run vagrant:win:dev
```

## Runtime Files

VM helper state is created under:

```text
C:\f-land\.vagrant-win
```

Logs are written to:

```text
C:\f-land\.vagrant-win\logs
```

Prod portable extraction goes to:

```text
C:\f-land\.vagrant-win\prod\portable
```

## Troubleshooting

WinRM timeout:

- Windows boxes can take several minutes on first boot.
- Re-run `vagrant provision fapland-win-dev` or `vagrant provision fapland-win-prod` after the VM finishes booting.

libvirt shared folder failures:

- This setup syncs the repo into `C:\f-land` with rsync by default.
- If rsync is unavailable in the Windows box, use `vagrant upload` or copy the repo over RDP, then re-run provisioning.
- If you opt into NFS and it fails, verify the NixOS NFS/firewall setup above.

Chocolatey failures:

- Rerun the relevant provision command after the VM has network access.
- Check Chocolatey logs inside the guest if package installation fails repeatedly.

Windows build failures:

- Native module rebuilds may require Visual Studio Build Tools and the C++ workload.
- The bootstrap script installs both, but they are large and can take a long time on first provision.

Missing portable zip:

- The prod provision expects `release\Fap Land-Portable-*.zip` after `npm run build:package`.
- Check `C:\f-land\.vagrant-win\logs` and the terminal output from `vagrant provision fapland-win-prod`.
