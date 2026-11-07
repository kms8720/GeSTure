"""Copy the donor index glTF resources without changing any geometry bytes."""
import copy
import hashlib
import json
import struct


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and length == len(data)
    size, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20 + size])
    start = 20 + size
    size, kind = struct.unpack_from('<II', data, start)
    assert kind == 0x004e4942
    return doc, data[start + 8:start + 8 + size]


def graft_index(output, donor_path):
    doc, binary = read_glb(output)
    donor, donor_binary = read_glb(donor_path)
    binary = bytearray(binary)
    maps = {key: {} for key in ('bufferViews', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes')}
    image_hashes = {}
    for index, image in enumerate(doc.get('images', [])):
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        image_hashes[(image['mimeType'], hashlib.sha256(binary[start:start + view['byteLength']]).digest())] = index

    def append(kind, old, value):
        items = doc.setdefault(kind, [])
        maps[kind][old] = len(items)
        items.append(value)
        return len(items) - 1

    def resource(kind, old):
        if old in maps[kind]:
            return maps[kind][old]
        value = copy.deepcopy(donor[kind][old])
        if kind == 'bufferViews':
            assert value.get('buffer', 0) == 0
            while len(binary) % 4:
                binary.append(0)
            start = value.get('byteOffset', 0)
            value['buffer'] = 0
            value['byteOffset'] = len(binary)
            binary.extend(donor_binary[start:start + value['byteLength']])
        elif kind == 'accessors':
            assert 'sparse' not in value
            value['bufferView'] = resource('bufferViews', value['bufferView'])
        elif kind == 'images':
            view = donor['bufferViews'][value['bufferView']]
            start = view.get('byteOffset', 0)
            key = (value['mimeType'], hashlib.sha256(donor_binary[start:start + view['byteLength']]).digest())
            if key in image_hashes:
                maps[kind][old] = image_hashes[key]
                return image_hashes[key]
            value['bufferView'] = resource('bufferViews', value['bufferView'])
        elif kind == 'textures':
            value['source'] = resource('images', value['source'])
            if 'sampler' in value:
                value['sampler'] = resource('samplers', value['sampler'])
        elif kind == 'materials':
            # Texture slots are the only resource indices in this donor material.
            def textures(obj):
                for key, item in obj.items():
                    if isinstance(item, dict):
                        if key.endswith('Texture') and 'index' in item:
                            item['index'] = resource('textures', item['index'])
                        else:
                            textures(item)
            textures(value)
        elif kind == 'meshes':
            for primitive in value['primitives']:
                assert 'targets' not in primitive and not primitive.get('extensions')
                primitive['attributes'] = {k: resource('accessors', v) for k, v in primitive['attributes'].items()}
                primitive['indices'] = resource('accessors', primitive['indices'])
                primitive['material'] = resource('materials', primitive['material'])
        elif kind == 'nodes':
            assert 'skin' not in value and 'matrix' not in value
            if 'mesh' in value:
                value['mesh'] = resource('meshes', value['mesh'])
            if 'children' in value:
                value['children'] = [resource('nodes', v) for v in value['children']]
        return append(kind, old, value)

    base = next(i for i, n in enumerate(donor['nodes']) if n.get('name') == 'index_base_pivot')
    assert not any(n.get('name') == 'index_base_pivot' for n in doc['nodes']), 'Generated index must be excluded before grafting'
    alignment = next(n for n in doc['nodes'] if n.get('name') == 'legacy_index_alignment')
    alignment['children'] = [resource('nodes', base)]
    for key in ('extensionsUsed', 'extensionsRequired'):
        if donor.get(key):
            doc[key] = sorted(set(doc.get(key, [])) | set(donor[key]))
    doc['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    with open(output, 'wb') as file:
        file.write(struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(binary)))
        file.write(struct.pack('<II', len(encoded), 0x4e4f534a)); file.write(encoded)
        file.write(struct.pack('<II', len(binary), 0x004e4942)); file.write(binary)

    parts = []
    for name in ('index_03', 'index_02', 'index_01'):
        node = next(n for n in donor['nodes'] if n.get('name') == name)
        primitive = donor['meshes'][node['mesh']]['primitives'][0]
        fingerprints = {}
        for role, accessor in dict(primitive['attributes'], INDICES=primitive['indices']).items():
            value = donor['accessors'][accessor]
            view = donor['bufferViews'][value['bufferView']]
            start = view.get('byteOffset', 0)
            fingerprints[role] = hashlib.sha256(donor_binary[start:start + view['byteLength']]).hexdigest()
        parts.append({'name': name, 'source': 'legacy-index', 'sourceNode': name,
                      'sourceTriangles': donor['accessors'][primitive['indices']]['count'] // 3,
                      'sourceBufferViewHashes': fingerprints})
    return parts
