# Build launcher: uses node_modules from D:\hatch-modules (J:\ is exFAT, no junctions)
$env:NODE_PATH = "D:\hatch-modules\node_modules"
$tsc = "D:\hatch-modules\node_modules\.bin\tsc.cmd"
$vite = "D:\hatch-modules\node_modules\.bin\vite.cmd"
& $tsc -b "J:\Project Data\Hatch\tsconfig.json"
if ($?) { & $vite build --root "J:\Project Data\Hatch" --config "J:\Project Data\Hatch\vite.config.ts" }
