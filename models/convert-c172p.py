#!/usr/bin/env python3
"""Makes models/c172p.glb, the stand-in Cessna, from FlightGear's Cessna 172P.

New in FSG, milestone 2 (docs/milestones/2.md, pull request 2). The owner's exception to "models are never
built by Claude Code": a borrowed model, converted by a script that is kept here.

The model is the c172p-team's (https://github.com/c172p-team/c172p), licence GPL version 2, at the commit
named below. This script fetches its exterior model (AC3D), its paint and its animation file, checks each
against the fingerprint on record, and writes one binary glTF to docs/models.md:

  - only the outside: no cabin, panel or crew, no tie-downs, cowl plugs, wheel fairings, floats or skis;
  - turned to the handoff's axes (nose -Z, right wing +X, up +Y), its origin at JSBSim's centre of gravity
    for `c172p` as loaded, and sat so that all three tyres touch the ground where JSBSim stands the airplane;
  - the paint brought down to 1,024 pixels;
  - the four motions the handoff asks of a fixed-gear airplane (flaps, elevator, aileron, rudder), each one
    second long, about FlightGear's own hinge lines and to FlightGear's own travel;
  - a `propeller` that the app turns, holding `propeller_blades` and `propeller_disc`;
  - the tyres as `wheel_nose`, `wheel_left` and `wheel_right`.

The gear is drawn at the length FlightGear models it, hanging free; FlightGear squeezes it under the
airplane's weight with animations this file does not carry. So that the tyres still stand on the ground, the
airplane's sit is fitted to them: it comes out about 2 degrees more nose-up than FlightGear draws it.

Run it from anywhere:  python3 models/convert-c172p.py
It needs Python 3 with Pillow (to shrink the paint) and the network (or --cache, a folder holding the files).
Run again it makes the same file byte for byte, on the same Pillow; tests/model.test.js checks the result.
"""
import argparse, hashlib, io, json, math, os, re, struct, sys, tempfile, urllib.request

from PIL import Image

COMMIT = '10a26158b6456244d84cbac27e6882bdc807f98c'
BASE = f'https://raw.githubusercontent.com/c172p-team/c172p/{COMMIT}/Models/'
# What is fetched, and the SHA-256 each must have.
SOURCES = {
    'c172-common.ac': '2026d777964edf0efd41db950392d19eccd503bf9f14288e1c6930a84072239b',
    'c172p.xml': '46070342dc08ca8b0713429786e1a61c8547aad0fd929fabcd8728440f24c1da',
    'fuselage.png': '0abd235787aff3875e4925dbdea66548ab4ebf777817f2f6440861555586a004',
    'wing.png': 'bac29254864db96988d8f4917df04d04e0a9915e5b0de52d9b9bd75a32553950',
    'tail.png': '2248e1fb506af432dd06904e79e6b2d42d228642226b1261ad982b1bae17f0ac',
    'prop.png': '441cbf5a9f6b605dfedf502b433449463aac455b0f51f92e018dc4debc9cf66f',
}

# ---- JSBSim's `c172p`, standing on its wheels (read back from a run of the game; tests/model.test.js
# reads them back again and holds the model to them). Inches and feet are JSBSim's.
CG_X_IN = 42.117                 # the centre of gravity as loaded, station
NOSE_X_IN, MAIN_X_IN = -6.8, 58.2   # the gear's stations in the aircraft file
STANDING_CG_FT = 4.3555          # the centre of gravity above the ground
STANDING_PITCH_DEG = 2.432       # nose up
IN, FT = 0.0254, 0.3048

# ---- What is left out. FlightGear shows or hides these with switches of its own; a chase camera needs none.
DROP_GROUPS = {'hotspots', 'tiedowns', 'interior', 'panel_up'}
DROP_NAMES = {'PropellerCowlPlugs', 'sun_and_view_blocker', 'panel_blocker', 'fairing1', 'fairing2', 'fairing3',
              'courtesyon-l', 'courtesyon-r',
              'windowframeleftext', 'windowframerightext'}   # blank panes that would hide the door windows' glass
DROP_TEXTURES = {'interior.png', 'panel.png', 'panel_parts.png', 'glass-alpha.png', 'lights.png'}
PAINT = ['fuselage.png', 'wing.png', 'tail.png', 'prop.png']
GLASS = (0.10, 0.13, 0.17)       # the windows, solid: there is no cabin behind them

# ---- The parts that move, by FlightGear's object names. Everything else is the airframe.
PARTS = {
    'wheel_nose': ['NoseWheel'], 'wheel_left': ['LeftWheel'], 'wheel_right': ['RightWheel'],
    'elevator_left': ['elevatorleft'], 'elevator_right': ['elevatorright', 'elevatortrim'],
    'rudder': ['rudder_1', 'RearNavLight', 'ruddercablelefthinge', 'ruddercablerighthinge'],
    'aileron_left': ['leftaileron'], 'aileron_right': ['rightaileron'],
    'flaps': ['flaps'],
    'propeller_blades': ['Propeller', 'Spinner'], 'propeller_disc': ['Propeller.Fast'],
}
# FlightGear's hinge lines and travel, from Models/c172p.xml at that commit, in its axes (x aft, y right,
# z up, metres). Each number is looked for in the fetched file, so a change upstream cannot pass unseen.
HINGES = {
    'elevator_left': ((4.87869, -0.1350, -0.42222), (4.7439, -1.7279, -0.4222)),
    'elevator_right': ((4.7439, 1.7279, -0.4222), (4.87869, 0.1350, -0.42222)),
    'rudder': ((4.918, 0, -0.310), (5.805, -0.013, 1.007)),
    'aileron_left': ((0.862, -5.464, 0.459), (1.158, -2.616, 0.337)),
    'aileron_right': ((1.158, 2.616, 0.337), (0.862, 5.464, 0.459)),
    'flaps': ((1.152, -0.53, 0.32), (1.152, 0.53, 0.32)),
}
ELEVATOR_UP, ELEVATOR_DOWN = 28, 23
AILERON_UP, AILERON_DOWN = 20, 15
RUDDER = 13
FLAPS, FLAPS_AFT_M, FLAPS_DOWN_M = 30, 0.08, 0.10
PROPELLER_AT = (-1.96139, 0.00127, -0.0519)
QUOTED = ['4.87869', '-1.7279', '4.918', '5.805', '1.007', '-5.464', '0.459', '1.158', '2.616', '0.337', '1.152',
          '<dep>28</dep>', '<dep>-23</dep>', '<dep>20</dep>', '<dep>-15</dep>', '<factor>13</factor>', '<factor>30</factor>',
          '<factor>0.08</factor>', '<factor>-0.10</factor>', '-1.96139', '-0.0519']


def fetch(cache):
    out = {}
    for name, want in SOURCES.items():
        path = os.path.join(cache, name)
        if not os.path.exists(path):
            print(f'fetching {name}')
            with urllib.request.urlopen(BASE + name) as response:
                data = response.read()
            with open(path, 'wb') as f:
                f.write(data)
        data = open(path, 'rb').read()
        got = hashlib.sha256(data).hexdigest()
        if want is None:
            print(f"    '{name}': '{got}',")
        elif got != want:
            sys.exit(f'{name}: SHA-256 {got}, expected {want}')
        out[name] = data
    return out


# ---- AC3D ----
def read_ac(text):
    """Returns (materials, objects): each object { name, groups, texture, crease, verts, surfs }, its
    vertices already moved by its own and its parents' `loc`. A surf is (flags, material, [(index, u, v)])."""
    lines = text.split('\n')
    if not lines[0].startswith('AC3D'):
        sys.exit('not an AC3D file')
    materials, objects, i = [], [], 1

    def parse(groups, at):
        nonlocal i
        o = {'name': '', 'texture': '', 'crease': 45.0, 'verts': [], 'surfs': [], 'loc': (0.0, 0.0, 0.0)}
        i += 1
        while i < len(lines):
            t = lines[i].split()
            key = t[0] if t else ''
            if key == 'name':
                o['name'] = lines[i].split('"')[1]
            elif key == 'data':
                i += 1
            elif key == 'texture':
                o['texture'] = lines[i].split('"')[1]
            elif key in ('rot', 'texrep', 'texoff'):
                if key == 'rot' or [float(x) for x in t[1:]] not in ([1.0, 1.0], [0.0, 0.0]):
                    sys.exit(f'{o["name"]}: {key} is not handled')
            elif key == 'crease':
                o['crease'] = float(t[1])
            elif key == 'loc':
                o['loc'] = tuple(float(x) for x in t[1:4])
            elif key == 'numvert':
                here = tuple(a + b for a, b in zip(at, o['loc']))
                for _ in range(int(t[1])):
                    i += 1
                    x, y, z = (float(v) for v in lines[i].split()[:3])
                    o['verts'].append((x + here[0], y + here[1], z + here[2]))
            elif key == 'numsurf':
                for _ in range(int(t[1])):
                    i += 1
                    flags = int(lines[i].split()[1], 16)
                    i += 1
                    material = int(lines[i].split()[1])
                    i += 1
                    refs = []
                    for _ in range(int(lines[i].split()[1])):
                        i += 1
                        r = lines[i].split()
                        refs.append((int(r[0]), float(r[1]), float(r[2])))
                    o['surfs'].append((flags, material, refs))
            elif key == 'kids':
                o['groups'] = groups
                objects.append(o)
                here = tuple(a + b for a, b in zip(at, o['loc']))
                i += 1
                for _ in range(int(t[1])):
                    parse(groups + [o['name']], here)
                i -= 1
                return
            i += 1

    while i < len(lines):
        if lines[i].startswith('MATERIAL'):
            m = re.match(r'MATERIAL "([^"]*)" rgb (\S+) (\S+) (\S+)', lines[i])
            materials.append({'name': m.group(1), 'rgb': tuple(float(m.group(k)) for k in (2, 3, 4))})
        elif lines[i].startswith('OBJECT'):
            parse([], (0.0, 0.0, 0.0))
        i += 1
    return materials, objects


# ---- small sums ----
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def unit(a):
    n = math.sqrt(dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 1.0, 0.0)
def from_ac(p): return (-p[2], p[1], p[0])       # AC3D (x aft, y up, z left) to the handoff (x right, y up, z aft)
def from_fg(p): return (p[1], p[2], p[0])        # FlightGear (x aft, y right, z up) to the handoff
def turn(p, axis, degrees):                      # Rodrigues: p turned about a unit axis through the origin
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    k = cross(axis, p)
    d = dot(axis, p) * (1 - c)
    return tuple(p[n] * c + k[n] * s + axis[n] * d for n in range(3))
def quaternion(axis, degrees):
    a = math.radians(degrees) / 2
    return [axis[0] * math.sin(a), axis[1] * math.sin(a), axis[2] * math.sin(a), math.cos(a)]


def triangles_of(o):
    """An object's triangles, as corners (position, normal, uv), with its smooth surfaces shaded across
    edges gentler than its crease angle, as AC3D draws them. Returns [(material, two_sided, [3 corners])]."""
    verts = [from_ac(v) for v in o['verts']]
    faces = []
    for flags, material, refs in o['surfs']:
        if flags & 0x0F or len(refs) < 3:
            continue   # a line, not a surface
        normal = (0.0, 0.0, 0.0)
        for k in range(1, len(refs) - 1):   # Newell-like: the sum of the fan's normals
            n = cross(sub(verts[refs[k][0]], verts[refs[0][0]]), sub(verts[refs[k + 1][0]], verts[refs[0][0]]))
            normal = (normal[0] + n[0], normal[1] + n[1], normal[2] + n[2])
        faces.append((flags, material, refs, unit(normal)))
    around = {}
    for f, (flags, _, refs, _) in enumerate(faces):
        if flags & 0x10:
            for index, _, _ in refs:
                around.setdefault(index, []).append(f)
    limit = math.cos(math.radians(o['crease']))
    out = []
    for flags, material, refs, normal in faces:
        corners = []
        for index, u, v in refs:
            n = normal
            if flags & 0x10:
                total = (0.0, 0.0, 0.0)
                for other in around[index]:
                    m = faces[other][3]
                    if dot(m, normal) >= limit:
                        total = (total[0] + m[0], total[1] + m[1], total[2] + m[2])
                n = unit(total)
            corners.append((verts[index], n, (u, 1.0 - v)))
        for k in range(1, len(corners) - 1):
            out.append((material, bool(flags & 0x20), [corners[0], corners[k], corners[k + 1]]))
    return out


class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.json = {'asset': {'version': '2.0', 'generator': 'FSG models/convert-c172p.py',
                               'copyright': 'c172p-team and the FlightGear contributors; GPL-2.0'},
                     'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [], 'meshes': [], 'materials': [], 'textures': [],
                     'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
                     'accessors': [], 'bufferViews': [], 'animations': []}

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.json['bufferViews'].append(v)
        return len(self.json['bufferViews']) - 1

    def accessor(self, values, kind, component='f', target=None, bounds=False):
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[kind]
        flat = [x for v in values for x in v] if width > 1 else list(values)
        a = {'bufferView': self.view(struct.pack(f'<{len(flat)}{component}', *flat), target),
             'componentType': {'f': 5126, 'H': 5123, 'I': 5125}[component], 'count': len(flat) // width, 'type': kind}
        if bounds:
            # As the 32-bit numbers actually written, so the bounds hold exactly.
            packed = struct.unpack(f'<{len(flat)}f', struct.pack(f'<{len(flat)}f', *flat))
            a['min'] = [min(packed[k::width]) for k in range(width)]
            a['max'] = [max(packed[k::width]) for k in range(width)]
        self.json['accessors'].append(a)
        return len(self.json['accessors']) - 1

    def write(self, path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.json['buffers'] = [{'byteLength': len(self.bin)}]
        if not self.json['animations']:
            del self.json['animations']
        text = json.dumps(self.json, separators=(',', ':')).encode()
        text += b' ' * (-len(text) % 4)
        total = 12 + 8 + len(text) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<4sII', b'glTF', 2, total))
            f.write(struct.pack('<I4s', len(text), b'JSON') + text)
            f.write(struct.pack('<I4s', len(self.bin), b'BIN\0') + bytes(self.bin))
        return total


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    args = argparse.ArgumentParser()
    args.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'fsg-c172p-' + COMMIT[:8]))
    args.add_argument('--out', default=os.path.join(here, 'c172p.glb'))
    args = args.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    files = fetch(args.cache)
    if None in SOURCES.values():
        sys.exit('put those fingerprints into SOURCES')
    xml = files['c172p.xml'].decode('utf-8', 'replace')
    for number in QUOTED:
        if number not in xml:
            sys.exit(f'{number} is no longer in FlightGear\'s Models/c172p.xml: its hinges have changed')

    materials, objects = read_ac(files['c172-common.ac'].decode('latin-1'))
    part_of = {name: part for part, names in PARTS.items() for name in names}
    kept = {}   # part -> [(material key, corners)]
    for o in objects:
        if not o['surfs'] or DROP_GROUPS & set(o['groups']) or o['name'] in DROP_NAMES or o['texture'] in DROP_TEXTURES:
            continue
        if o['texture'] and o['texture'] not in PAINT:
            sys.exit(f'{o["name"]}: unexpected texture {o["texture"]}')
        part = part_of.get(o['name'], 'airframe')
        for material, two_sided, corners in triangles_of(o):
            if o['texture']:
                key = (o['texture'], two_sided, part == 'propeller_disc')
            else:
                key = ('glass' if 'glas' in materials[material]['name'].lower() else materials[material]['rgb'], two_sided, False)
            kept.setdefault(part, []).append((key, corners))
    missing = [part for part in PARTS if part not in kept]
    if missing:
        sys.exit(f'not found in the model: {missing}')

    # ---- the sit: all three tyres on the ground where JSBSim stands the airplane ----
    def tyre(part):
        ys = [c[0][1] for _, corners in kept[part] for c in corners]
        zs = [c[0][2] for _, corners in kept[part] for c in corners]
        xs = [c[0][0] for _, corners in kept[part] for c in corners]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2), (max(ys) - min(ys)) / 2
    (nose, nose_r), (left, left_r), (right, right_r) = tyre('wheel_nose'), tyre('wheel_left'), tyre('wheel_right')
    main = tuple((a + b) / 2 for a, b in zip(left, right))
    main_r = (left_r + right_r) / 2
    theta = math.radians(STANDING_PITCH_DEG)
    want_nose, want_main = (CG_X_IN - NOSE_X_IN) * IN, (CG_X_IN - MAIN_X_IN) * IN   # forward of the centre of gravity

    def placed(p, a, ty, tz):   # the model's point in body axes: turned about the wing's axis, then moved
        return (p[0], p[1] * math.cos(a) - p[2] * math.sin(a) + ty, p[1] * math.sin(a) + p[2] * math.cos(a) + tz)
    def height(p, r, a, ty, tz):   # of a tyre's lowest point above the ground, standing
        q = placed(p, a, ty, tz)
        return STANDING_CG_FT * FT + (-q[2]) * math.sin(theta) + q[1] * math.cos(theta) - r
    lo, hi = math.radians(-10), math.radians(10)
    for _ in range(60):   # the turn that puts nose and main tyres at the same height
        a = (lo + hi) / 2
        if height(nose, nose_r, a, 0, 0) - height(main, main_r, a, 0, 0) > 0:
            hi = a
        else:
            lo = a
    # Fore and aft: FlightGear's wheelbase and JSBSim's differ a little; the difference is shared.
    tz = -((want_nose + placed(nose, a, 0, 0)[2]) + (want_main + placed(main, a, 0, 0)[2])) / 2
    ty = -height(main, main_r, a, 0, tz)  / math.cos(theta)
    print(f'sit: turned {math.degrees(a):+.2f} deg (nose up positive), moved {ty:+.3f} m up and {tz:+.3f} m aft')
    for name, p, r, want in (('nose', nose, nose_r, want_nose), ('left main', left, left_r, want_main), ('right main', right, right_r, want_main)):
        q = placed(p, a, ty, tz)
        print(f'  {name}: {(-q[2] - want) / IN:+.2f} in ahead of JSBSim\'s, {abs(q[0]) / IN:.2f} in out, {height(p, r, a, ty, tz) / IN:+.2f} in above the ground')

    # ---- the file ----
    glb = Glb()
    j = glb.json
    j['nodes'].append({'name': 'c172p', 'children': [], 'translation': [0, ty, tz], 'rotation': quaternion((1, 0, 0), math.degrees(a))})

    material_index, texture_index = {}, {}
    def texture(name):
        if name not in texture_index:
            image = Image.open(io.BytesIO(files[name]))
            if name == 'prop.png':
                data, mime = files[name], 'image/png'   # small, and its see-through disc needs its alpha
            else:
                image = image.convert('RGB')
                if max(image.size) > 1024:
                    image = image.resize((1024, 1024), Image.LANCZOS)
                buffer = io.BytesIO()
                image.save(buffer, 'JPEG', quality=88)
                data, mime = buffer.getvalue(), 'image/jpeg'
            j['images'].append({'name': name.split('.')[0], 'mimeType': mime, 'bufferView': glb.view(data)})
            j['textures'].append({'sampler': 0, 'source': len(j['images']) - 1})
            texture_index[name] = len(j['textures']) - 1
        return texture_index[name]
    def material(key):
        if key not in material_index:
            what, two_sided, see_through = key
            m = {'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.6}}
            if what == 'glass':
                m['name'] = 'glass'
                m['pbrMetallicRoughness'].update(baseColorFactor=[*GLASS, 1], roughnessFactor=0.2)
            elif isinstance(what, str):
                m['name'] = what.split('.')[0] + ('_disc' if see_through else '')
                m['pbrMetallicRoughness']['baseColorTexture'] = {'index': texture(what)}
                if see_through:
                    m['alphaMode'] = 'BLEND'
            else:
                m['name'] = 'plain_%02x%02x%02x' % tuple(round(c * 255) for c in what)
                m['pbrMetallicRoughness']['baseColorFactor'] = [*what, 1]
            if two_sided or see_through:
                m['doubleSided'] = True
                m['name'] += '_2'
            j['materials'].append(m)
            material_index[key] = len(j['materials']) - 1
        return material_index[key]

    def mesh(part, origin):
        by = {}
        for key, corners in kept[part]:
            by.setdefault(key, []).append(corners)
        primitives = []
        for key in sorted(by, key=str):
            seen, positions, normals, uvs, indices = {}, [], [], [], []
            for corners in by[key]:
                for p, n, uv in corners:
                    corner = (struct.pack('<3f', *sub(p, origin)), struct.pack('<3f', *n), struct.pack('<2f', *uv))
                    if corner not in seen:
                        seen[corner] = len(positions)
                        positions.append(sub(p, origin)); normals.append(n); uvs.append(uv)
                    indices.append(seen[corner])
            attributes = {'POSITION': glb.accessor(positions, 'VEC3', target=34962, bounds=True), 'NORMAL': glb.accessor(normals, 'VEC3', target=34962)}
            if isinstance(key[0], str) and key[0] != 'glass':
                attributes['TEXCOORD_0'] = glb.accessor(uvs, 'VEC2', target=34962)
            primitives.append({'attributes': attributes, 'material': material(key),
                               'indices': glb.accessor(indices, 'SCALAR', 'H' if len(positions) < 65536 else 'I', target=34963)})
        j['meshes'].append({'name': part, 'primitives': primitives})
        return len(j['meshes']) - 1

    def node(name, part=None, origin=(0.0, 0.0, 0.0), parent=0, about=None):
        """A node under `parent`, at `origin` in its parent; its mesh, if it has one, is laid out about `about`
        (the node's own origin unless told otherwise)."""
        n = {'name': name}
        if part:
            n['mesh'] = mesh(part, about if about is not None else origin)
        if any(origin):
            n['translation'] = list(origin)
        j['nodes'].append(n)
        j['nodes'][parent].setdefault('children', []).append(len(j['nodes']) - 1)
        return len(j['nodes']) - 1

    node('airframe', 'airframe')
    for wheel in ('wheel_nose', 'wheel_left', 'wheel_right'):
        node(wheel, wheel)

    # The hinged parts: each a node on its hinge line, turned about it. Which way is "up" is found from
    # the part itself: its rearmost point is its trailing edge.
    times = glb.accessor([0.0, 0.5, 1.0], 'SCALAR')
    j['accessors'][times].update(min=[0.0], max=[1.0])
    hinged = {}
    for part, (p1, p2) in HINGES.items():
        origin, axis = from_fg(p1), unit(sub(from_fg(p2), from_fg(p1)))
        points = [sub(c[0], origin) for _, corners in kept[part] for c in corners]
        edge = max(points, key=lambda p: p[2])
        moved = turn(edge, axis, 5)
        sign = (1 if moved[0] > edge[0] else -1) if part == 'rudder' else (1 if moved[1] > edge[1] else -1)   # +: trailing edge right, or up
        hinged[part] = (node(part, part, origin), axis, sign)
    def motion(name, turns, slide=None):
        channels, samplers = [], []
        for part, degrees in turns.items():
            index, axis, sign = hinged[part]
            samplers.append({'input': times, 'output': glb.accessor([quaternion(axis, sign * d) for d in degrees], 'VEC4'), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': index, 'path': 'rotation'}})
            if slide:
                base = j['nodes'][index]['translation']
                samplers.append({'input': times, 'output': glb.accessor([[base[k] + s[k] for k in range(3)] for s in slide], 'VEC3'), 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': index, 'path': 'translation'}})
        j['animations'].append({'name': name, 'channels': channels, 'samplers': samplers})
    # 0 s, 0.5 s, 1 s, as docs/models.md has them; degrees are trailing edge up (right, for the rudder).
    motion('flaps', {'flaps': [0, -FLAPS / 2, -FLAPS]}, slide=[(0, 0, 0), (0, -FLAPS_DOWN_M / 2, FLAPS_AFT_M / 2), (0, -FLAPS_DOWN_M, FLAPS_AFT_M)])
    motion('elevator', {'elevator_left': [-ELEVATOR_DOWN, 0, ELEVATOR_UP], 'elevator_right': [-ELEVATOR_DOWN, 0, ELEVATOR_UP]})
    motion('aileron', {'aileron_left': [AILERON_UP, 0, -AILERON_DOWN], 'aileron_right': [-AILERON_DOWN, 0, AILERON_UP]})
    motion('rudder', {'rudder': [-RUDDER, 0, RUDDER]})

    hub = from_fg(PROPELLER_AT)
    propeller = node('propeller', origin=hub)
    node('propeller_blades', 'propeller_blades', parent=propeller, about=hub)
    node('propeller_disc', 'propeller_disc', parent=propeller, about=hub)

    total = glb.write(args.out)
    count = sum(len(v) for v in kept.values())
    print(f'{args.out}: {total:,} bytes, {count:,} triangles, {len(j["materials"])} materials, {len(j["images"])} textures')


if __name__ == '__main__':
    main()
