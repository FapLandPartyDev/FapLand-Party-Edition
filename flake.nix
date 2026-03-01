{
  description = "Prisma compat layer for nix";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/master";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };

      # Create an overridden prisma-engines that includes the query-engine bin
      my-prisma-engines = pkgs.prisma-engines.overrideAttrs (oldAttrs: {
        cargoBuildFlags = (oldAttrs.cargoBuildFlags or []) ++ [ "-p" "query-engine" ];
        postInstall = (oldAttrs.postInstall or "") + ''
          if [ -f target/${oldAttrs.cargoBuildType or "release"}/query-engine ]; then
            cp target/${oldAttrs.cargoBuildType or "release"}/query-engine $out/bin/query-engine
          fi
        '';
      });
    in {
      devShell = pkgs.mkShell {
        nativeBuildInputs = [ pkgs.bashInteractive ];
        buildInputs = with pkgs; [
          prisma
          supabase-cli
          postgresql
          nodejs_24
          ffmpeg
          pkg-config
          qemu
          vagrant
          nfs-utils
          freerdp

          # Electron (NixOS-patched binary — avoids dynamic linker mismatch)
          electron

          # Wayland / graphics for Electron/Chromium
          libGL
          libdrm
          mesa
          wayland
          libx11
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxrandr
          libxcb
          nss
          nspr
          expat
          cups
          dbus
          glib-networking
          gtk3
          openssl

          # Git
          git-lfs

          appimage-run
          yt-dlp

          #Intiface
          intiface-central
        ];
        shellHook = with pkgs; ''
          # Prisma engines
          export PRISMA_SCHEMA_ENGINE_BINARY="${prisma-engines}/bin/schema-engine"
          export PRISMA_QUERY_ENGINE_LIBRARY="${prisma-engines}/lib/libquery_engine.node"
          export PRISMA_INTROSPECTION_ENGINE_BINARY="${prisma-engines}/bin/introspection-engine"
          export PRISMA_FMT_BINARY="${prisma-engines}/bin/prisma-fmt"

          # Point Electron (and vite-plugin-electron) at the NixOS-patched binary
          export ELECTRON_OVERRIDE_DIST_PATH="${electron}/libexec/electron"

          # Wayland / Ozone
          export NIXOS_OZONE_WL=1
          export GDK_BACKEND=wayland,x11
          export XDG_DATA_DIRS="${gtk3}/share/gsettings-schemas/${gtk3.name}:$XDG_DATA_DIRS"

          # Vagrant/libvirt Windows test VMs. The vagrant-libvirt plugin is
          # installed per-user because this nixpkgs revision does not expose it
          # as a top-level package.
          export VAGRANT_DEFAULT_PROVIDER="libvirt"
          export VAGRANT_HOME="''${VAGRANT_HOME:-$HOME/.vagrant.d}"
          export FLAND_WINDOWS_BOX="''${FLAND_WINDOWS_BOX:-jborean93/WindowsServer2022}"
          export FLAND_VAGRANT_SYNC_TYPE="''${FLAND_VAGRANT_SYNC_TYPE:-rsync}"
          export FLAND_VAGRANT_NFS_VERSION="''${FLAND_VAGRANT_NFS_VERSION:-4}"
          export FLAND_WIN_PROJECT_DIR="''${FLAND_WIN_PROJECT_DIR:-C:/f-land}"
          export FLAND_WIN_NODE_VERSION="''${FLAND_WIN_NODE_VERSION:-24.13.0}"

          if ! command -v vagrant >/dev/null 2>&1; then
            echo "warning: vagrant is not available in this dev shell"
          fi

          if ! vagrant plugin list 2>/dev/null | grep -q '^vagrant-libvirt '; then
            echo "warning: vagrant-libvirt plugin is not installed in VAGRANT_HOME=$VAGRANT_HOME"
            echo "         run: vagrant plugin install vagrant-libvirt"
          fi
        '';
      };
    });
}
