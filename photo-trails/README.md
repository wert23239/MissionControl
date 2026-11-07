# Photo Trails
Browser-local photo GPS + capture time parsing, Leaflet photo-order map, Google Maps links (maximum three intermediate waypoints per part for mobile compatibility), and GPX export. No server or photo persistence. Tiles are fetched from OpenStreetMap; Google Maps receives stops when a link is opened. Embedded capture times may lack timezone information. Missing capture times fall back to import order after dated photos. HEIC metadata is handled by exifr; browser thumbnail support varies. Original Apple Photos exports preserve metadata best.

Verification: generated JPEG GPS/time fixtures imported through actual Chrome browser; missing-GPS/corrupt rejection, sorting, travel mode, remove/clear/demo, desktop/mobile overflow, map tiles, zero runtime errors. Core tests: `node tests/photo-trails/route.cjs`. A real Apple HEIC export has not yet been acceptance-tested.

Bundled dependencies: exifr 7.1.3 (MIT), Leaflet 1.9.4 (BSD-2-Clause). Font styles from Google Fonts. No API keys required.
