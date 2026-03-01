!macro customInstall
  FileOpen $0 "$INSTDIR\.fland-installed" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\.fland-installed"
!macroend
