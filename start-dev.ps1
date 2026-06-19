# Run from D:\hatch-modules so Node finds vite in node_modules there.
# J:\ is exFAT — no symlinks/junctions — so node_modules lives on D:\ (NTFS).
Set-Location "D:\hatch-modules"
& ".\node_modules\.bin\vite.cmd" "J:\Project Data\Hatch"
