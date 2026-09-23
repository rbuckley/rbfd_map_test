// Map importer · editable city outline: the pure geometry behind seeding an
// editable, extendable boundary from a pulled city and inserting new vertices.
import { jsdomEnv, ok, section, done } from './harness.mjs';
jsdomEnv();
const { downsampleRing, segmentDistance, nearestEdgeInsertIndex } = await import('../js/mapImporter.js');

section('downsampleRing: caps vertices, drops the closing duplicate');
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];   // closed ring (dup last)
const ds = downsampleRing(square, 32);
ok(ds.length === 4, 'closing duplicate dropped, small ring kept whole');
ok(ds[0][0] === 0 && ds[0][1] === 0, 'first vertex preserved');
const big = Array.from({ length: 100 }, (_, i) => [i, i * 2]);
const dsBig = downsampleRing(big, 32);
ok(dsBig.length === 32, '100-point ring reduced to the target 32');
ok(dsBig[0][0] === 0 && dsBig[0][1] === 0, 'downsample keeps the starting vertex');

section('segmentDistance: on-segment, perpendicular, past-the-end clamp');
ok(segmentDistance([5, 0], [0, 0], [10, 0]) === 0, 'point on the segment → 0');
ok(segmentDistance([5, 3], [0, 0], [10, 0]) === 3, 'perpendicular distance');
ok(segmentDistance([15, 0], [0, 0], [10, 0]) === 5, 'past the end clamps to the endpoint');

section('nearestEdgeInsertIndex: a new point lands on the closest edge of the ring');
const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];   // bottom, right, top, left
ok(nearestEdgeInsertIndex(ring, [5, -1]) === 1, 'near bottom edge → insert after v0');
ok(nearestEdgeInsertIndex(ring, [11, 5]) === 2, 'near right edge → insert after v1');
ok(nearestEdgeInsertIndex(ring, [5, 11]) === 3, 'near top edge → insert after v2');
ok(nearestEdgeInsertIndex(ring, [-1, 5]) === 4, 'near left edge → insert at the end (wraps to v0)');

done();
