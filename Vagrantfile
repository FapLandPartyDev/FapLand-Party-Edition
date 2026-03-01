# -*- mode: ruby -*-
# vi: set ft=ruby :

VAGRANTFILE_API_VERSION = "2"

WINDOWS_BOX = ENV.fetch("FLAND_WINDOWS_BOX", "jborean93/WindowsServer2022")
VM_CPUS = Integer(ENV.fetch("FLAND_VM_CPUS", "4"))
VM_MEMORY = Integer(ENV.fetch("FLAND_VM_MEMORY", "8192"))
SOURCE_DIR = File.expand_path(__dir__)
PROJECT_DIR = ENV.fetch("FLAND_WIN_PROJECT_DIR", "C:/f-land")
NODE_VERSION = ENV.fetch("FLAND_WIN_NODE_VERSION", "24.11.1")
DEV_PORT = ENV.fetch("FLAND_WIN_DEV_PORT", "3000")
REMOTE_DEBUGGING_PORT = ENV.fetch("FLAND_WIN_REMOTE_DEBUGGING_PORT", "9222")
RDP_HOST_PORT = Integer(ENV.fetch("FLAND_WIN_RDP_PORT", "3389"))
SYNC_TYPE = ENV.fetch("FLAND_VAGRANT_SYNC_TYPE", "rsync")
NFS_VERSION = Integer(ENV.fetch("FLAND_VAGRANT_NFS_VERSION", "4"))
SOURCE_EXCLUDES = [
  ".git/",
  ".vagrant/",
  ".vagrant-win/",
  "node_modules/",
  "dist/",
  "dist-electron/",
  "release/",
  "UserLogs/",
  "database-backups/",
  "settings-backups/",
  "dev.db",
  "dev.db-shm",
  "dev.db-wal"
].freeze

def configure_windows_fapland_vm(machine, hostname)
  machine.vm.box = WINDOWS_BOX
  machine.vm.hostname = hostname
  machine.vm.guest = :windows
  machine.vm.communicator = "winrm"

  machine.winrm.username = "vagrant"
  machine.winrm.password = "vagrant"
  machine.winrm.timeout = 1800
  machine.winrm.execution_time_limit = "PT4H"
  machine.winrm.transport = :negotiate

  sync_options = if SYNC_TYPE == "nfs"
    {
      type: "nfs",
      nfs_version: NFS_VERSION
    }
  elsif SYNC_TYPE == "rsync"
    {
      type: "rsync",
      rsync__exclude: SOURCE_EXCLUDES
    }
  else
    {
      type: SYNC_TYPE
    }
  end

  machine.vm.synced_folder SOURCE_DIR, PROJECT_DIR, sync_options

  machine.vm.network "forwarded_port", guest: 3389, host: RDP_HOST_PORT, auto_correct: true, id: "#{hostname}-rdp"

  machine.vm.provider :libvirt do |libvirt|
    libvirt.cpus = VM_CPUS
    libvirt.memory = VM_MEMORY
  end

  machine.vm.provision "bootstrap", type: "shell", privileged: true, path: "vagrant/windows/bootstrap.ps1", args: [
    "-ProjectDir", PROJECT_DIR,
    "-NodeVersion", NODE_VERSION,
    "-DevPort", DEV_PORT,
    "-RemoteDebuggingPort", REMOTE_DEBUGGING_PORT
  ]
end

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box_check_update = false

  config.vm.define "fapland-win-dev" do |dev|
    configure_windows_fapland_vm(dev, "fapland-win-dev")

    dev.vm.provision "fapland-dev", type: "shell", privileged: true, path: "vagrant/windows/run-dev.ps1", args: [
      "-ProjectDir", PROJECT_DIR,
      "-DevPort", DEV_PORT,
      "-RemoteDebuggingPort", REMOTE_DEBUGGING_PORT
    ]

    dev.vm.post_up_message = <<~MESSAGE
      Fap Land Windows dev VM is up.

      Connect with:
        npm run vagrant:win:dev:rdp

      The app starts from the interactive Windows logon task named FapLandDev.
      Logs are in #{PROJECT_DIR}/.vagrant-win/logs.
    MESSAGE
  end

  config.vm.define "fapland-win-prod" do |prod|
    configure_windows_fapland_vm(prod, "fapland-win-prod")

    prod.vm.provision "fapland-prod", type: "shell", privileged: true, path: "vagrant/windows/build-prod.ps1", args: [
      "-ProjectDir", PROJECT_DIR
    ]

    prod.vm.post_up_message = <<~MESSAGE
      Fap Land Windows prod VM is up.

      Connect with:
        npm run vagrant:win:prod:rdp

      The packaged portable app starts from the interactive Windows logon task named FapLandProd.
      Logs are in #{PROJECT_DIR}/.vagrant-win/logs.
    MESSAGE
  end
end
