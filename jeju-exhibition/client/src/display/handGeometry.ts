import { BufferGeometry, Mesh, Object3D } from 'three';

/** Hide detached scan slivers carried by two pinky joints.
 * The middle segment's three slivers have X 0.1078–0.1216 (shell ends at 0.0578).
 * A fourth, tiny base-segment sliver has Z -0.0974–-0.0883 (shell starts at -0.0822).
 * Filter complete triangles only in these segments, preserving the source GLB,
 * joint hardware, UVs and the shared loader geometry used by other views.
 */
export function removePinkyScanFragments(model: Object3D): BufferGeometry[]
{
  const copies: BufferGeometry[] = [];
  const fragments = [
    { segment: 'pinky_intermediate', axis: 0, outside: (value: number) => value > 0.1 },
    { segment: 'pinky_proximal', axis: 2, outside: (value: number) => value < -0.085 },
  ];
  for (const { segment, axis, outside } of fragments) model.getObjectByName(segment)?.traverse((object) =>
  {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.index;
    if (!positions || !index) return;
    const kept: number[] = [];
    for (let i = 0; i < index.count; i += 3)
    {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if ([a, b, c].every(vertex => outside(positions.getComponent(vertex, axis)))) continue;
      kept.push(a, b, c);
    }
    if (kept.length === index.count) return;
    const copy = geometry.clone();
    copy.setIndex(kept);
    object.geometry = copy;
    copies.push(copy);
  });
  return copies;
}
