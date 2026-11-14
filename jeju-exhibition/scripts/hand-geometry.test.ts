import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { removePinkyScanFragments } from '../client/src/display/handGeometry.js';

test('real exhibition model hides only the 242 detached pinky triangles without changing the shared source', async () =>
{
  const file = readFileSync(new URL('../public/models/hand_exhibition.glb', import.meta.url));
  const jsonSize = file.readUInt32LE(12);
  const document = JSON.parse(file.subarray(20, 20 + jsonSize).toString());
  // Geometry-only loading avoids requiring a browser image decoder in this check.
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  document.buffers[0].uri = 'data:application/octet-stream;base64,' + file.subarray(28 + jsonSize).toString('base64');
  if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', { value: class {} });
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(document), '');
  const model = scene.clone(true);
  const original = new Map<string, BufferGeometry>();
  scene.traverse(object => { if (object instanceof Mesh) original.set(object.name, object.geometry); });
  const copies = removePinkyScanFragments(model);
  assert.equal(copies.length, 2);
  const expected = {
    pinky_intermediate: { sourceCount: 10842, removed: 238, axis: 0, kept: (value: number) => value < 0.1 },
    pinky_proximal: { sourceCount: 17244, removed: 4, axis: 2, kept: (value: number) => value > -0.085 },
  };
  let removed = 0, changed = 0;
  model.traverse(object =>
  {
    if (!(object instanceof Mesh)) return;
    const source = original.get(object.name)!;
    if (object.geometry === source) return;
    changed++;
    const contract = expected[object.parent?.name as keyof typeof expected];
    assert.ok(contract, 'Only the two identified pinky segments may change');
    removed += (source.index!.count - object.geometry.index.count) / 3;
    assert.equal((source.index!.count - object.geometry.index.count) / 3, contract.removed);
    assert.equal(source.index!.count, contract.sourceCount);
    for (const attribute of Object.keys(source.attributes))
      assert.deepEqual(object.geometry.getAttribute(attribute).array, source.getAttribute(attribute).array);
    const positions = object.geometry.getAttribute('position');
    for (const index of object.geometry.index.array) assert.ok(contract.kept(positions.getComponent(index, contract.axis)));
  });
  assert.equal(changed, 2);
  assert.equal(removed, 242);
  assert.equal(removePinkyScanFragments(model).length, 0, 'Repeated cleanup must be a no-op');
  for (const geometry of copies) geometry.dispose();
});
