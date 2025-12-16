import * as GREEN from 'green';
import { OrbitControls } from 'green/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'green/addons/environments/RoomEnvironment.js';

let scene, camera, renderer, controls, clock;
let sunLight, ambientLight, housePointLight;
let fieldMesh, pondMesh, pondRimMesh;
let houseGroup, gardenGroup;
let treesGroup, trunksInst, foliageInst;
let grassGroup, shortGrassInst, tallGrassInst;
let rainInst, rainData;
let pmrem;
let simTime = 0;
let windowMeshes = [];

const state = {
  fieldSize: 190,
  grassDensityPct: 70,
  windStrengthPct: 35,
  treeCountPct: 60,
  timeOfDayPct: 6,
  weather: 'clear',

  windBase: 0.55,
  windMultiplier: 1.0,

  pond: { x: -14, z: 10, rx: 7.2, rz: 4.9, waterY: 0 },
  house: { x: 0, z: 0 },
  garden: { x: 7.8, z: 1.5 },

  rain: {
    count: 2600,
    area: 54,
    top: 32,
    bottom: -2,
    tiltX: -0.68,
    gust: 0.0
  }
};

const ui = {
  density: document.getElementById('grassDensity'),
  wind: document.getElementById('windStrength'),
  trees: document.getElementById('treeCount'),
  weather: document.getElementById('weather'),
  tod: document.getElementById('timeOfDay'),

  densityValue: document.getElementById('grassDensityValue'),
  windValue: document.getElementById('windStrengthValue'),
  treesValue: document.getElementById('treeCountValue'),
  weatherPill: document.getElementById('weatherPill'),
  todValue: document.getElementById('timeOfDayValue'),
};

initScene();
buildField();
buildPond();
buildHouse();
buildGarden();
buildTrees();
buildGrass();
buildWeatherFX();

setWeather(state.weather);
setTimeOfDay(state.timeOfDayPct / 24);

hookUI();
animate();

function initScene() {
  scene = new GREEN.Scene();

  camera = new GREEN.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    600
  );
  camera.position.set(22, 14, 22);

  renderer = new GREEN.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = GREEN.SRGBColorSpace;
  renderer.toneMapping = GREEN.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = GREEN.PCFSoftShadowMap;

  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 10;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 2.2, 0);
  controls.update();

  ambientLight = new GREEN.AmbientLight(0xffffff, 0.42);
  scene.add(ambientLight);

  sunLight = new GREEN.DirectionalLight(0xffffff, 1.15);
  sunLight.position.set(18, 26, 12);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 85;
  sunLight.shadow.camera.left = -32;
  sunLight.shadow.camera.right = 32;
  sunLight.shadow.camera.top = 32;
  sunLight.shadow.camera.bottom = -32;
  sunLight.shadow.bias = -0.00025;
  scene.add(sunLight);

  clock = new GREEN.Clock();

  pmrem = new GREEN.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
  scene.environment = envTex;

  window.addEventListener('resize', onResize);
}

function buildField() {
  const size = state.fieldSize;
  const seg = 140;

  const geo = new GREEN.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = groundHeight(x, z);

    const pd = pondDist01(x, z);
    if (pd < 1.0) {
      const k = 1.0 - pd;
      y -= 0.95 * k * k;
    }

    const hx = x - state.house.x;
    const hz = z - state.house.z;
    const hDist = Math.sqrt(hx * hx + hz * hz);
    if (hDist < 7.0) {
      const t = smoothstep(7.0, 2.0, hDist);
      y = GREEN.MathUtils.lerp(y, 0.02, t);
    }

    const gx = x - state.garden.x;
    const gz = z - state.garden.z;
    const gDist = Math.sqrt(gx * gx + gz * gz);
    if (gDist < 6.0) {
      const t = smoothstep(6.0, 2.2, gDist);
      y = GREEN.MathUtils.lerp(y, 0.015, t);
    }

    pos.setY(i, y);
  }

  geo.computeVertexNormals();

  const mat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#2e8f46'),
    roughness: 0.95,
    metalness: 0.0,
  });

  fieldMesh = new GREEN.Mesh(geo, mat);
  fieldMesh.receiveShadow = true;
  scene.add(fieldMesh);
}

function buildGrass() {
  grassGroup = grassGroup || new GREEN.Group();
  if (!grassGroup.parent) scene.add(grassGroup);
  rebuildGrass();
}

function buildHouse() {
  houseGroup = new GREEN.Group();
  houseGroup.position.set(state.house.x, 0, state.house.z);
  scene.add(houseGroup);

  const wallMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#f2efe7'),
    roughness: 0.92,
    metalness: 0.0,
  });

  const roofMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#8b3b2c'),
    roughness: 0.8,
    metalness: 0.0,
  });

  const trimMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#3a3a3a'),
    roughness: 0.85,
    metalness: 0.0,
  });

  const walls = new GREEN.Mesh(new GREEN.BoxGeometry(6.2, 3.2, 5.2), wallMat);
  walls.position.set(0, 1.6, 0);
  walls.castShadow = true;
  walls.receiveShadow = true;
  houseGroup.add(walls);

  const roofW = 6.6;
  const roofH = 2.15;
  const roofL = 5.6;

  const shape = new GREEN.Shape();
  shape.moveTo(-roofW / 2, 0);
  shape.lineTo(0, roofH);
  shape.lineTo(roofW / 2, 0);
  shape.closePath();

  const roofGeo = new GREEN.ExtrudeGeometry(shape, {
    depth: roofL,
    bevelEnabled: false,
    steps: 1,
  });
  roofGeo.rotateY(Math.PI);
  roofGeo.translate(0, 3.2, roofL / 2);
  const roof = new GREEN.Mesh(roofGeo, roofMat);
  roof.castShadow = true;
  roof.receiveShadow = true;
  houseGroup.add(roof);

  const doorMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#6f4a2b'),
    roughness: 0.85,
    metalness: 0.0,
  });
  const door = new GREEN.Mesh(new GREEN.BoxGeometry(1.05, 1.85, 0.16), doorMat);
  door.position.set(-0.6, 0.92, 2.68);
  door.castShadow = true;
  houseGroup.add(door);

  const step = new GREEN.Mesh(new GREEN.BoxGeometry(1.6, 0.15, 0.7), trimMat);
  step.position.set(-0.6, 0.08, 2.52);
  step.castShadow = true;
  step.receiveShadow = true;
  houseGroup.add(step);

  const winMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#bfe8ff'),
    roughness: 0.25,
    metalness: 0.0,
    emissive: new GREEN.Color('#ffcc88'),
    emissiveIntensity: 0.0,
  });

  windowMeshes = [];
  const winGeo = new GREEN.PlaneGeometry(0.9, 0.65);

  const w1 = new GREEN.Mesh(winGeo, winMat);
  w1.position.set(1.6, 1.7, 2.62);
  w1.rotation.y = Math.PI;
  houseGroup.add(w1);

  const w2 = new GREEN.Mesh(winGeo, winMat);
  w2.position.set(-2.4, 1.7, 2.62);
  w2.rotation.y = Math.PI;
  houseGroup.add(w2);

  const w3 = new GREEN.Mesh(winGeo, winMat);
  w3.position.set(3.18, 1.65, 0.6);
  w3.rotation.y = -Math.PI / 2;
  houseGroup.add(w3);

  const w4 = new GREEN.Mesh(winGeo, winMat);
  w4.position.set(3.18, 1.65, -1.35);
  w4.rotation.y = -Math.PI / 2;
  houseGroup.add(w4);

  windowMeshes.push(w1, w2, w3, w4);

  const chim = new GREEN.Mesh(new GREEN.BoxGeometry(0.65, 1.55, 0.65), trimMat);
  chim.position.set(-2.2, 4.0, -0.8);
  chim.castShadow = true;
  houseGroup.add(chim);

  housePointLight = new GREEN.PointLight(0xffc48a, 0.0, 18, 2.0);
  housePointLight.position.set(1.2, 2.2, 3.8);
  housePointLight.castShadow = false;
  scene.add(housePointLight);
}

function buildGarden() {
  gardenGroup = new GREEN.Group();
  gardenGroup.position.set(state.garden.x, 0, state.garden.z);
  scene.add(gardenGroup);

  const fenceMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#d8d0c6'),
    roughness: 0.95,
    metalness: 0.0,
  });

  const soilMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#4a2f1d'),
    roughness: 1.0,
    metalness: 0.0,
  });

  const trimMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#6b6b6b'),
    roughness: 0.9,
    metalness: 0.0,
  });

  const w = 6.6;
  const d = 4.2;

  const base = new GREEN.Mesh(new GREEN.BoxGeometry(w + 0.25, 0.12, d + 0.25), trimMat);
  base.position.set(0, 0.06, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  gardenGroup.add(base);

  const railGeoH = new GREEN.BoxGeometry(w, 0.1, 0.08);
  const railGeoV = new GREEN.BoxGeometry(0.08, 0.1, d);

  const rail1 = new GREEN.Mesh(railGeoH, fenceMat);
  rail1.position.set(0, 0.55, d / 2);
  const rail2 = rail1.clone();
  rail2.position.set(0, 0.55, -d / 2);
  const rail3 = new GREEN.Mesh(railGeoV, fenceMat);
  rail3.position.set(w / 2, 0.55, 0);
  const rail4 = rail3.clone();
  rail4.position.set(-w / 2, 0.55, 0);
  [rail1, rail2, rail3, rail4].forEach(m => {
    m.castShadow = true;
    m.receiveShadow = true;
    gardenGroup.add(m);
  });

  const postGeo = new GREEN.BoxGeometry(0.12, 0.9, 0.12);
  const postPositions = [
    [-w / 2, 0.45, -d / 2],
    [ w / 2, 0.45, -d / 2],
    [-w / 2, 0.45,  d / 2],
    [ w / 2, 0.45,  d / 2],
  ];
  for (const p of postPositions) {
    const post = new GREEN.Mesh(postGeo, fenceMat);
    post.position.set(p[0], p[1], p[2]);
    post.castShadow = true;
    post.receiveShadow = true;
    gardenGroup.add(post);
  }

  const bed1 = new GREEN.Mesh(new GREEN.BoxGeometry(2.65, 0.25, 3.2), soilMat);
  bed1.position.set(-1.7, 0.18, 0);
  bed1.castShadow = true;
  bed1.receiveShadow = true;

  const bed2 = new GREEN.Mesh(new GREEN.BoxGeometry(2.65, 0.25, 3.2), soilMat);
  bed2.position.set(1.7, 0.18, 0);
  bed2.castShadow = true;
  bed2.receiveShadow = true;

  gardenGroup.add(bed1, bed2);

  const stemGeo = new GREEN.CylinderGeometry(0.03, 0.05, 0.45, 6);
  const leafGeo = new GREEN.SphereGeometry(0.12, 8, 8);
  const plantMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#2f9a4b'),
    roughness: 0.9,
    metalness: 0.0,
  });

  const stems = new GREEN.InstancedMesh(stemGeo, plantMat, 28);
  const leaves = new GREEN.InstancedMesh(leafGeo, plantMat, 28);
  stems.castShadow = true;
  leaves.castShadow = true;

  const dummy = new GREEN.Object3D();
  for (let i = 0; i < 28; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const bx = side * (1.7 + (Math.random() * 0.9 - 0.45));
    const bz = (Math.random() * 2.6 - 1.3);
    const y = 0.32;

    const s = 0.8 + Math.random() * 0.7;

    dummy.position.set(bx, y + 0.2 * s, bz);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    dummy.position.set(bx, y + 0.45 * s, bz);
    dummy.scale.setScalar(0.9 * s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  stems.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;

  gardenGroup.add(stems, leaves);
}

function buildTrees() {
  treesGroup = treesGroup || new GREEN.Group();
  if (!treesGroup.parent) scene.add(treesGroup);
  rebuildTrees();
}

function buildPond() {
  const rimMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#25462d'),
    roughness: 0.98,
    metalness: 0.0,
  });

  const centerY = groundHeight(state.pond.x, state.pond.z) - 0.6;
  state.pond.waterY = centerY;

  const waterGeo = new GREEN.CircleGeometry(1, 72);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.scale(state.pond.rx, 1, state.pond.rz);

  const waterMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#2c9aa6'),
    roughness: 0.08,
    metalness: 0.0,
    transparent: true,
    opacity: 0.86,
  });

  addWaterWobble(waterMat);

  pondMesh = new GREEN.Mesh(waterGeo, waterMat);
  pondMesh.position.set(state.pond.x, centerY + 0.03, state.pond.z);
  scene.add(pondMesh);

  const rimGeo = new GREEN.TorusGeometry(1, 0.06, 10, 84);
  rimGeo.rotateX(Math.PI / 2);
  rimGeo.scale(state.pond.rx, 1, state.pond.rz);
  pondRimMesh = new GREEN.Mesh(rimGeo, rimMat);
  pondRimMesh.position.set(state.pond.x, centerY + 0.05, state.pond.z);
  pondRimMesh.castShadow = true;
  pondRimMesh.receiveShadow = true;
  scene.add(pondRimMesh);
}

function todText(h) {
  const hour = Math.max(0, Math.min(24, Math.round(h)));

  let tag = '';
  if (hour === 0 || hour === 24) tag = 'Dawn';
  else if (hour === 12) tag = 'Noon';
  else if (hour === 17) tag = 'Dusk';
  else if (hour >= 17 && hour <= 23) tag = 'Night';

  return tag ? `${hour}h \u00b7 ${tag}` : `${hour}h`;
}


function buildWeatherFX() {
  const geo = new GREEN.PlaneGeometry(0.03, 1.55);
  const mat = new GREEN.MeshBasicMaterial({
    color: new GREEN.Color('#dbe9ff'),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });

  const count = state.rain.count;
  rainInst = new GREEN.InstancedMesh(geo, mat, count);
  rainInst.frustumCulled = false;
  rainInst.visible = false;
  scene.add(rainInst);


  rainData = new Array(count);
  const dummy = new GREEN.Object3D();

  const area = state.rain.area;
  const cx = controls?.target?.x ?? 0;
  const cz = controls?.target?.z ?? 0;

  state.rain._cx = cx;
  state.rain._cz = cz;

  for (let i = 0; i < count; i++) {
    const x = cx + (Math.random() * 2 - 1) * area;
    const z = cz + (Math.random() * 2 - 1) * area;
    const y = 6 + Math.random() * state.rain.top;

    const s = 0.75 + Math.random() * 1.35;
    const v = 22 + Math.random() * 34;

    const seed = Math.random() * 1000;
    rainData[i] = { x, y, z, s, v, seed };

    dummy.position.set(x, y, z);
    dummy.rotation.set(state.rain.tiltX, 0, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    rainInst.setMatrixAt(i, dummy.matrix);
  }

  rainInst.instanceMatrix.needsUpdate = true;
}


function setTimeOfDay(t) {
  const daySky = new GREEN.Color('#bfe6ff');
  const morningSky = new GREEN.Color('#cfe8ff');
  const duskSky = new GREEN.Color('#2b3b57');
  const nightSky = new GREEN.Color('#0b0f1a');

  let sky = new GREEN.Color();
  if (t < 0.55) {
    sky.copy(morningSky).lerp(daySky, smoothstep(0.05, 0.55, t));
  } else {
    sky.copy(duskSky).lerp(nightSky, smoothstep(0.55, 1.0, t));
  }

  const wTint = weatherSkyTint(state.weather);
  sky.lerp(wTint, wTint.userData.mix);

  scene.background = sky;

  const sunIntensity = GREEN.MathUtils.lerp(1.25, 0.05, smoothstep(0.62, 1.0, t));
  sunLight.intensity = sunIntensity * weatherSunMult(state.weather);

  const ambIntensity = GREEN.MathUtils.lerp(0.48, 0.12, smoothstep(0.62, 1.0, t));
  ambientLight.intensity = ambIntensity * weatherAmbientMult(state.weather);

  const morningSun = new GREEN.Color('#ffd7a3');
  const daySun = new GREEN.Color('#ffffff');
  const nightSun = new GREEN.Color('#9bb7ff');

  const sunCol = new GREEN.Color();
  sunCol.copy(morningSun).lerp(daySun, smoothstep(0.10, 0.50, t));
  sunCol.lerp(nightSun, smoothstep(0.60, 1.0, t));
  sunLight.color.copy(sunCol);

  const elev = GREEN.MathUtils.lerp(0.22, 0.03, smoothstep(0.55, 1.0, t));
  const az = GREEN.MathUtils.lerp(0.85, 1.25, t) * Math.PI;
  const r = 30;
  sunLight.position.set(
    Math.cos(az) * r,
    8 + elev * 38,
    Math.sin(az) * r
  );

  const nightOn = t > 0.72;
  const wEm = nightOn ? GREEN.MathUtils.lerp(0.0, 1.8, smoothstep(0.72, 1.0, t)) : 0.0;
  for (const w of windowMeshes) {
    w.material.emissiveIntensity = wEm;
    w.material.needsUpdate = true;
  }

  housePointLight.intensity = nightOn ? GREEN.MathUtils.lerp(0.0, 2.2, smoothstep(0.74, 1.0, t)) : 0.0;
}

function setWeather(kind) {
  state.weather = kind;

  if (kind === 'clear') {
    scene.fog = null;
    state.windMultiplier = 1.0;
    if (pondMesh) pondMesh.material.roughness = 0.08;
    if (rainInst) {
      rainInst.visible = false;
      rainInst.material.opacity = 0.0;
    }
  }

  if (kind === 'misty') {
    const fogCol = new GREEN.Color('#cfe2df');
    scene.fog = new GREEN.FogExp2(fogCol, 0.020);
    state.windMultiplier = 0.85;
    if (pondMesh) pondMesh.material.roughness = 0.12;
    if (rainInst) {
      rainInst.visible = false;
      rainInst.material.opacity = 0.0;
    }
  }

  if (kind === 'stormy') {
    const fogCol = new GREEN.Color('#3a4657');
    scene.fog = new GREEN.FogExp2(fogCol, 0.030);
    state.windMultiplier = 1.55;
    if (pondMesh) pondMesh.material.roughness = 0.26;
    if (rainInst) {
      rainInst.visible = true;
      rainInst.material.opacity = 0.45;
    }
  }

  ui.weatherPill.textContent = kind[0].toUpperCase() + kind.slice(1);
  setTimeOfDay(state.timeOfDayPct / 100);
  applyWindToMaterials();
}

function rebuildTrees() {
  if (trunksInst) {
    trunksInst.geometry.dispose();
    trunksInst.material.dispose();
    treesGroup.remove(trunksInst);
    trunksInst = null;
  }
  if (foliageInst) {
    foliageInst.geometry.dispose();
    foliageInst.material.dispose();
    treesGroup.remove(foliageInst);
    foliageInst = null;
  }

  const count = treeCountFromPct(state.treeCountPct);

  const trunkGeo = new GREEN.CylinderGeometry(0.26, 0.34, 3.1, 6);
  const foliageGeo = new GREEN.IcosahedronGeometry(1.55, 0);

  const trunkMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#6b4b2a'),
    roughness: 0.95,
    metalness: 0.0,
  });

  const folMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#2c8f43'),
    roughness: 0.92,
    metalness: 0.0,
  });

  trunksInst = new GREEN.InstancedMesh(trunkGeo, trunkMat, count);
  foliageInst = new GREEN.InstancedMesh(foliageGeo, folMat, count);
  trunksInst.castShadow = true;
  foliageInst.castShadow = true;

  const dummy = new GREEN.Object3D();
  const dummy2 = new GREEN.Object3D();

  const placed = [];
  let tries = 0;

  for (let i = 0; i < count; i++) {
    let px = 0, pz = 0;
    let ok = false;

    while (!ok && tries < 5000) {
      tries++;
      const r = GREEN.MathUtils.lerp(12, 38, Math.random());
      const a = Math.random() * Math.PI * 2;
      px = Math.cos(a) * r;
      pz = Math.sin(a) * r;

      if (pondDist01(px, pz) < 1.25) continue;
      if (dist2(px, pz, state.house.x, state.house.z) < 10.5 * 10.5) continue;
      if (dist2(px, pz, state.garden.x, state.garden.z) < 8.0 * 8.0) continue;

      const half = state.fieldSize * 0.46;
      if (px < -half || px > half || pz < -half || pz > half) continue;

      ok = true;
      for (const p of placed) {
        if (dist2(px, pz, p.x, p.z) < (4.6 * 4.6)) {
          ok = false;
          break;
        }
      }
    }

    placed.push({ x: px, z: pz });

    const baseY = groundHeight(px, pz) + 0.02;
    const s = 0.75 + Math.random() * 0.8;
    const rot = Math.random() * Math.PI * 2;

    dummy.position.set(px, baseY + 1.55 * s, pz);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(s, s * (0.95 + Math.random() * 0.25), s);
    dummy.updateMatrix();
    trunksInst.setMatrixAt(i, dummy.matrix);

    dummy2.position.set(px, baseY + 3.2 * s + 0.45, pz);
    dummy2.rotation.set(0, rot * 0.65, 0);
    dummy2.scale.set(
      s * (1.05 + Math.random() * 0.45),
      s * (1.0 + Math.random() * 0.35),
      s * (1.05 + Math.random() * 0.45)
    );
    dummy2.updateMatrix();
    foliageInst.setMatrixAt(i, dummy2.matrix);
  }

  trunksInst.instanceMatrix.needsUpdate = true;
  foliageInst.instanceMatrix.needsUpdate = true;

  treesGroup.add(trunksInst, foliageInst);
}

function rebuildGrass() {
  if (shortGrassInst) {
    disposeInstanced(shortGrassInst);
    grassGroup.remove(shortGrassInst);
    shortGrassInst = null;
  }
  if (tallGrassInst) {
    disposeInstanced(tallGrassInst);
    grassGroup.remove(tallGrassInst);
    tallGrassInst = null;
  }

  const total = grassTotalFromPct(state.grassDensityPct);

  const shortCount = Math.floor(total * 0.78);
  const tallCount = total - shortCount;

  const shortH = 0.65;
  const shortGeo = bladeGeometry(0.08, shortH, 4);

  const shortMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#2a9b4a'),
    roughness: 0.95,
    metalness: 0.0,
  });
  addGrassSway(shortMat, shortH);

  shortGrassInst = new GREEN.InstancedMesh(shortGeo, shortMat, shortCount);
  shortGrassInst.frustumCulled = true;

  const dummy = new GREEN.Object3D();
  const half = state.fieldSize * 0.47;

  for (let i = 0; i < shortCount; i++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;

    const pd = pondDist01(x, z);
    if (pd < 1.1) {
      i--;
      continue;
    }

    const baseY = groundHeight(x, z) + 0.02;
    const s = 0.72 + Math.random() * 0.85;
    const w = 0.9 + Math.random() * 0.6;

    dummy.position.set(x, baseY, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(w, s, w);
    dummy.updateMatrix();
    shortGrassInst.setMatrixAt(i, dummy.matrix);
  }
  shortGrassInst.instanceMatrix.needsUpdate = true;

  const tallH = 1.25;
  const tallGeo = bladeGeometry(0.10, tallH, 5);

  const tallMat = new GREEN.MeshStandardMaterial({
    color: new GREEN.Color('#239a44'),
    roughness: 0.95,
    metalness: 0.0,
  });
  addGrassSway(tallMat, tallH);

  tallGrassInst = new GREEN.InstancedMesh(tallGeo, tallMat, tallCount);
  tallGrassInst.frustumCulled = true;

  const patches = makeTallPatches();
  for (let i = 0; i < tallCount; i++) {
    const p = patches[Math.floor(Math.random() * patches.length)];
    const r = 2.2 + Math.random() * 2.8;
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * r + (Math.random() - 0.5) * 0.6;
    const z = p.z + Math.sin(a) * r + (Math.random() - 0.5) * 0.6;

    if (pondDist01(x, z) < 1.15) {
      i--;
      continue;
    }
    if (dist2(x, z, state.house.x, state.house.z) < 10.0 * 10.0) {
      i--;
      continue;
    }

    const baseY = groundHeight(x, z) + 0.02;
    const s = 0.85 + Math.random() * 1.25;
    const w = 0.9 + Math.random() * 0.75;

    dummy.position.set(x, baseY, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(w, s, w);
    dummy.updateMatrix();
    tallGrassInst.setMatrixAt(i, dummy.matrix);
  }
  tallGrassInst.instanceMatrix.needsUpdate = true;

  grassGroup.add(shortGrassInst, tallGrassInst);
  applyWindToMaterials();
}

function hookUI() {
  const panel = document.getElementById('ui');
  const stop = (e) => e.stopPropagation();
  ['pointerdown','pointerup','pointermove','wheel','contextmenu'].forEach(ev => {
    panel.addEventListener(ev, stop, { passive: false });
  });
  panel.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });

  ui.density.addEventListener('input', () => {
    state.grassDensityPct = Number(ui.density.value);
    ui.densityValue.textContent = `${state.grassDensityPct}%`;
    debounce('grass', () => rebuildGrass(), 120);
  });

  ui.wind.addEventListener('input', () => {
    state.windStrengthPct = Number(ui.wind.value);
    ui.windValue.textContent = `${state.windStrengthPct}%`;
    applyWindToMaterials();
  });

  ui.trees.addEventListener('input', () => {
    state.treeCountPct = Number(ui.trees.value);
    ui.treesValue.textContent = `${state.treeCountPct}%`;
    debounce('trees', () => rebuildTrees(), 120);
  });

  ui.weather.addEventListener('change', () => {
    setWeather(ui.weather.value);
  });

  ui.tod.addEventListener('input', () => {
  state.timeOfDayPct = Number(ui.tod.value);
  ui.todValue.textContent = todText(state.timeOfDayPct);
  setTimeOfDay(state.timeOfDayPct / 24);
  });


  ui.densityValue.textContent = `${state.grassDensityPct}%`;
  ui.windValue.textContent = `${state.windStrengthPct}%`;
  ui.treesValue.textContent = `${state.treeCountPct}%`;
  ui.todValue.textContent = todText(state.timeOfDayPct);
  ui.weatherPill.textContent = 'Clear';
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033);
  simTime += dt;
  const t = simTime;

  if (shortGrassInst?.material?.userData?.uTime) shortGrassInst.material.userData.uTime.value = t;
  if (tallGrassInst?.material?.userData?.uTime) tallGrassInst.material.userData.uTime.value = t;
  if (pondMesh?.material?.userData?.uTime) pondMesh.material.userData.uTime.value = t;

  if (rainInst?.visible) updateRain(dt, t);

  controls.update();
  renderer.render(scene, camera);
}


function updateRain(dt, t) {
  const dummy = new GREEN.Object3D();

  const cx = controls.target.x;
  const cz = controls.target.z;


  const prevCx = state.rain._cx ?? cx;
  const prevCz = state.rain._cz ?? cz;
  const shiftX = cx - prevCx;
  const shiftZ = cz - prevCz;
  state.rain._cx = cx;
  state.rain._cz = cz;

  const baseWind = windStrength();
  const gust = 0.55 + 0.45 * Math.sin(t * 0.85);
  const w = baseWind * (0.65 + 0.7 * gust);

  
  const windX = w * 22.0;
  const windZ = w * 10.0;

  const area = state.rain.area;
  const top = state.rain.top;
  const bottom = state.rain.bottom;

  for (let i = 0; i < rainData.length; i++) {
    const p = rainData[i];


    p.x += shiftX;
    p.z += shiftZ;


    p.y -= p.v * (1.0 + 0.15 * gust) * dt;

 
    const turbX = Math.sin(t * 1.15 + p.seed) * 1.2;
    const turbZ = Math.cos(t * 1.05 + p.seed) * 0.9;
    p.x += (windX + turbX) * dt;
    p.z += (windZ + turbZ) * dt;


    if (p.y < bottom) {
      p.y = 6 + top + Math.random() * 10;
      p.x = cx + (Math.random() * 2 - 1) * area;
      p.z = cz + (Math.random() * 2 - 1) * area;
      p.s = 0.75 + Math.random() * 1.35;
      p.v = 22 + Math.random() * 34;
      p.seed = Math.random() * 1000;
    }

    // keep volume tight 
    if (Math.abs(p.x - cx) > area * 1.35 || Math.abs(p.z - cz) > area * 1.35) {
      p.x = cx + (Math.random() * 2 - 1) * area;
      p.z = cz + (Math.random() * 2 - 1) * area;
    }

    const tiltX = state.rain.tiltX + w * 0.32;
    const yaw = Math.atan2(windX, windZ); 

    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(tiltX, yaw, 0);
    dummy.scale.set(p.s, p.s, p.s);
    dummy.updateMatrix();
    rainInst.setMatrixAt(i, dummy.matrix);
  }

  rainInst.instanceMatrix.needsUpdate = true;
}


function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function groundHeight(x, z) {
  const a = Math.sin(x * 0.055) * 0.32;
  const b = Math.cos(z * 0.048) * 0.28;
  const c = Math.sin((x + z) * 0.030) * 0.22;
  const d = Math.cos((x - z) * 0.018) * 0.18;
  return (a + b + c + d) * 0.9;
}

function pondDist01(x, z) {
  const dx = (x - state.pond.x) / state.pond.rx;
  const dz = (z - state.pond.z) / state.pond.rz;
  return dx * dx + dz * dz;
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function bladeGeometry(width, height, segY) {
  const geo = new GREEN.PlaneGeometry(width, height, 1, segY);
  geo.translate(0, height / 2, 0);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const tt = clamp01(y / height);
    pos.setX(i, pos.getX(i) + (tt * tt) * 0.03);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function addGrassSway(material, bladeH) {
  material.userData.uTime = { value: 0 };
  material.userData.uWind = { value: 0 };
  material.userData.uBladeH = { value: bladeH };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.uTime;
    shader.uniforms.uWind = material.userData.uWind;
    shader.uniforms.uBladeH = material.userData.uBladeH;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWind;
      uniform float uBladeH;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float tt = clamp(position.y / max(uBladeH, 0.0001), 0.0, 1.0);
      float bend = tt * tt;

      vec3 instPos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
      float n = sin(uTime * 1.25 + instPos.x * 0.17 + instPos.z * 0.21) +
                cos(uTime * 0.90 + instPos.x * 0.11 - instPos.z * 0.16);
      float sway = n * 0.5;

      transformed.x += sway * uWind * bend * 0.22;
      transformed.z += cos(uTime * 1.1 + instPos.z * 0.18) * uWind * bend * 0.12;
      `
    );
  };

  material.needsUpdate = true;
}

function addWaterWobble(material) {
  material.userData.uTime = { value: 0 };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.uTime;

    shader.vertexShader =
      `
      uniform float uTime;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float w1 = sin(uTime * 0.9 + position.x * 2.2 + position.z * 1.8);
      float w2 = cos(uTime * 1.2 + position.x * 1.1 - position.z * 2.6);
      transformed.y += (w1 * 0.5 + w2 * 0.5) * 0.055;
      `
    );
  };

  material.needsUpdate = true;
}

function applyWindToMaterials() {
  const w = windStrength();
  if (shortGrassInst?.material?.userData?.uWind) shortGrassInst.material.userData.uWind.value = w;
  if (tallGrassInst?.material?.userData?.uWind) tallGrassInst.material.userData.uWind.value = w * 1.08;
}

function windStrength() {
  const user = state.windStrengthPct / 100;
  const base = state.windBase;
  return base * user * state.windMultiplier;
}

function grassTotalFromPct(pct) {
  const tt = clamp01(pct / 100);
  const min = 3500;
  const max = 22000;
  return Math.floor(GREEN.MathUtils.lerp(min, max, tt));
}

function treeCountFromPct(pct) {
  const tt = clamp01(pct / 100);
  const min = 6;
  const max = 10;
  return Math.floor(GREEN.MathUtils.lerp(min, max, tt) + 0.001);
}

function makeTallPatches() {
  const half = state.fieldSize * 0.33;
  const patches = [];
  const target = 6;

  let tries = 0;
  while (patches.length < target && tries < 800) {
    tries++;
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;

    if (pondDist01(x, z) < 1.25) continue;
    if (dist2(x, z, state.house.x, state.house.z) < 11.5 * 11.5) continue;
    if (dist2(x, z, state.garden.x, state.garden.z) < 9.0 * 9.0) continue;

    let ok = true;
    for (const p of patches) {
      if (dist2(x, z, p.x, p.z) < 8.5 * 8.5) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    patches.push({ x, z });
  }

  if (patches.length === 0) {
    patches.push({ x: -18, z: -16 }, { x: 18, z: -10 }, { x: -6, z: 22 });
  }
  return patches;
}

function disposeInstanced(inst) {
  if (!inst) return;
  if (inst.geometry) inst.geometry.dispose();
  if (inst.material) inst.material.dispose();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0, edge1, x) {
  const tt = clamp01((x - edge0) / (edge1 - edge0));
  return tt * tt * (3 - 2 * tt);
}

function debounce(key, fn, ms) {
  debounce._t = debounce._t || {};
  clearTimeout(debounce._t[key]);
  debounce._t[key] = setTimeout(fn, ms);
}

function weatherSunMult(kind) {
  if (kind === 'misty') return 0.72;
  if (kind === 'stormy') return 0.52;
  return 1.0;
}

function weatherAmbientMult(kind) {
  if (kind === 'misty') return 0.95;
  if (kind === 'stormy') return 0.9;
  return 1.0;
}

function weatherSkyTint(kind) {
  const c = new GREEN.Color('#000000');
  c.userData = { mix: 0.0 };
  if (kind === 'misty') {
    c.set('#d5e7e1');
    c.userData.mix = 0.16;
  }
  if (kind === 'stormy') {
    c.set('#273043');
    c.userData.mix = 0.28;
  }
  return c;
}
