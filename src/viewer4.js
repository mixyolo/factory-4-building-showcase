import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const viewport = document.getElementById('viewer');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dce3df');
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, .05, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
viewport.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .08;
controls.maxPolarAngle = Math.PI * .49;
controls.minDistance = 4;
controls.maxDistance = 160;
controls.screenSpacePanning = true;

const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment, .04).texture;
scene.environmentIntensity = .45;
environment.dispose();
pmrem.dispose();
const hemisphere = new THREE.HemisphereLight('#dae9f3', '#77745c', .9);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#ffdfab', 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: .5, far: 140 });
sun.shadow.normalBias = .035;
sun.shadow.bias = -.0001;
scene.add(sun, sun.target);

const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
const sectionFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 100);
let modelRoot;
let modelBounds;
let sceneBounds;
let sectionHeight = 3.3;
let sectionCamera;
let cameraFlight;
const interiorLights = [];
const materials = [];
let glassMaterial;
let interiorMaterial;
let roomLabelMode = '1F';
let sectionOpenedByRoomLabel = false;
const roomLabels = [];

const sectionToggle = document.getElementById('section-toggle');
const sectionPanel = document.getElementById('section-panel');
const heightSlider = document.getElementById('section-height');
const loading = document.getElementById('loading');
const roomLabelLayer = document.getElementById('room-labels');
const roomFloorButtons = [...document.querySelectorAll('[data-room-floor]')];

const daySky = new THREE.Color('#dce3df');
const nightSky = new THREE.Color('#14242e');
const dayHemi = new THREE.Color('#dae9f3');
const nightHemi = new THREE.Color('#53738c');
const dayGround = new THREE.Color('#77745c');
const nightGround = new THREE.Color('#10151b');
const highSun = new THREE.Color('#ffedc7');
const lowSun = new THREE.Color('#ffad70');
function makeMicroRoughnessTexture() {
  const size = 64;
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = 164 + Math.floor(Math.random() * 48);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 18);
  texture.needsUpdate = true;
  return texture;
}

function setDefaultLighting() {
  const time = 15.5;
  const solar = Math.sin((time - 6) / 24 * Math.PI * 2);
  const daylight = THREE.MathUtils.smoothstep(solar, -.12, .16);
  const darkness = 1 - daylight;
  const azimuth = time / 24 * Math.PI * 2 - Math.PI;
  const elevation = solar * THREE.MathUtils.degToRad(62);
  const horizontal = Math.cos(elevation) * 38;
  sun.position.set(Math.cos(azimuth) * horizontal, Math.sin(elevation) * 38, Math.sin(azimuth) * horizontal);
  sun.target.position.set(0, 0, 0);
  sun.color.lerpColors(lowSun, highSun, THREE.MathUtils.smoothstep(Math.max(solar, 0), 0, .7));
  sun.intensity = Math.pow(Math.max(solar, 0), .55) * 3.2;
  scene.background.lerpColors(nightSky, daySky, daylight);
  scene.environmentIntensity = .12 + daylight * .33;
  hemisphere.color.lerpColors(nightHemi, dayHemi, daylight);
  hemisphere.groundColor.lerpColors(nightGround, dayGround, daylight);
  hemisphere.intensity = .34 + daylight * .56;
  renderer.toneMappingExposure = .82 + daylight * .18;
  interiorLights.forEach(light => { light.intensity = .58 + darkness * 2.2; });
  if (glassMaterial) glassMaterial.emissiveIntensity = darkness * .18;
  if (interiorMaterial) interiorMaterial.emissiveIntensity = darkness * .08;
}

function updateSection() {
  const enabled = sectionToggle.getAttribute('aria-pressed') === 'true';
  const percent = Number(heightSlider.value);
  sectionPlane.constant = enabled ? sectionHeight * percent / 100 : 100;
  const secondFloor = enabled && percent >= 50;
  const floorCutHeight = modelBounds ? modelBounds.min.y + sectionHeight * .43 : 0;
  sectionFloorPlane.constant = secondFloor ? -floorCutHeight : 100;
  document.getElementById('section-value').textContent = `${percent}%`;
  viewport.dataset.sectionHeight = String(sectionPlane.constant);
}

sectionToggle.addEventListener('click', () => {
  const enabled = sectionToggle.getAttribute('aria-pressed') !== 'true';
  const fromRoomLabel = sectionOpenedByRoomLabel;
  sectionOpenedByRoomLabel = false;
  if (enabled && roomLabelMode !== 'off' && !fromRoomLabel) setRoomLabelMode('off', false);
  sectionToggle.setAttribute('aria-pressed', String(enabled));
  sectionToggle.setAttribute('aria-expanded', String(enabled));
  sectionToggle.querySelector('span').textContent = enabled ? '返回完整建筑' : '切片查看';
  sectionPanel.hidden = !enabled;
  if (enabled) sectionCamera = { position: camera.position.clone(), target: controls.target.clone() };
  const target = enabled ? new THREE.Vector3(0, sectionHeight * .42, 0) : sectionCamera.target;
  const position = enabled ? target.clone().addScaledVector(new THREE.Vector3(1, 1.5, 1.15).normalize(), camera.aspect < 1 ? 42 : 32) : sectionCamera.position;
  cameraFlight = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, target, start: performance.now(), duration: 700 };
  if (!enabled && roomLabelMode !== 'off') setRoomLabelMode('off', false);
  updateSection();
});
heightSlider.addEventListener('input', () => {
  if (roomLabelMode !== 'off') setRoomLabelMode('off', false);
  updateSection();
});
controls.addEventListener('start', () => { cameraFlight = null; });

function setRoomLabelMode(mode, openSection = true) {
  roomLabelMode = mode;
  roomFloorButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.roomFloor === mode)));
  roomLabelLayer.setAttribute('aria-hidden', String(mode === 'off'));
  if (mode === 'off' && openSection && sectionToggle.getAttribute('aria-pressed') === 'true') {
    sectionToggle.click();
    return;
  }
  if (mode !== 'off' && openSection) {
    heightSlider.value = mode === '1F' ? '30' : '64';
    if (sectionToggle.getAttribute('aria-pressed') !== 'true') {
      sectionOpenedByRoomLabel = true;
      sectionToggle.click();
    }
    else updateSection();
    const target = new THREE.Vector3(0, sectionHeight * (mode === '1F' ? .22 : .5), 0);
    const distance = camera.aspect < .65 ? 68 : camera.aspect < 1 ? 56 : 48;
    const position = target.clone().addScaledVector(new THREE.Vector3(1, 1.5, 1.15).normalize(), distance);
    cameraFlight = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, target, start: performance.now(), duration: 700 };
  }
}
roomFloorButtons.forEach(button => button.addEventListener('click', () => setRoomLabelMode(button.dataset.roomFloor)));

function setupRoomLabels(bounds) {
  const height = bounds.max.y - bounds.min.y;
  const floorY = { '1F': bounds.min.y + 1.45, '2F': bounds.min.y + height * .475 + 1.25 };
  const rooms = [
    ['1F', '01', '大会议室', -8.6, 8.8], ['1F', '02', '大厅 / 前台', 2.1, 8.8],
    ['1F', '03', '中会议室', 10.8, 8.8], ['1F', '04', '多功能区', 2.1, -.2],
    ['1F', '05', '小会议室 1', 10.8, -2.65], ['1F', '06', '小会议室 2', 10.8, 1.6],
    ['1F', '07', 'IT 机房', 4.8, -10.2], ['1F', '08', '数采间', 10.7, -10.1],
    ['1F', '09', '配电间', -2.9, -11.5], ['1F', '10', '保洁 / 储藏', -4.5, -7.8],
    ['1F', '11', '茶水间', -7.1, -11.2], ['1F', '12', '女生卫生间', -11.1, -10.5],
    ['1F', '13', '男生卫生间', -11.1, -7.25], ['1F', '14', '洗手区', -7.0, -7.45],
    ['1F', '15', '楼梯间', -8.0, -2.2],
    ['2F', '01', '开放办公区', -2.8, 4.1], ['2F', '02', '会议室 1', 10.8, -9.0],
    ['2F', '03', '会议室 2', 10.8, -2.1], ['2F', '04', '会议室 3', 10.8, 7.8],
    ['2F', '05', '办公室', 5.4, -9.9], ['2F', '06', '资料室', -.8, -9.9],
    ['2F', '07', '茶水间', -7.1, -11.2], ['2F', '08', '女生卫生间', -11.1, -10.5],
    ['2F', '09', '男生卫生间', -11.1, -7.25], ['2F', '10', '洗手区', -7.0, -7.45],
    ['2F', '11', '走道', -2.8, -6.4], ['2F', '12', '楼梯间', -8.0, -2.2],
  ];
  rooms.forEach(([floor, code, name, x, z], index) => {
    const element = document.createElement('div');
    element.className = 'room-label';
    element.dataset.floor = floor;
    element.dataset.align = x > 7 ? 'left' : x < -7 ? 'right' : index % 3 === 0 ? 'left' : 'right';
    element.innerHTML = `<i class="room-label-anchor"></i><span class="room-label-card"><small class="room-label-code">${floor}-${code}</small><strong class="room-label-name">${name}</strong></span>`;
    roomLabelLayer.append(element);
    roomLabels.push({ floor, element, position: new THREE.Vector3(x, floorY[floor], z) });
  });
}

function updateRoomLabels() {
  if (roomLabelMode === 'off') {
    roomLabels.forEach(label => { label.element.hidden = true; });
    return;
  }
  const width = innerWidth;
  const height = innerHeight;
  roomLabels.forEach(label => {
    if (label.floor !== roomLabelMode) { label.element.hidden = true; return; }
    const projected = label.position.clone().project(camera);
    const x = (projected.x * .5 + .5) * width;
    const y = (-projected.y * .5 + .5) * height;
    const outside = projected.z < -1 || projected.z > 1 || x < 18 || x > width - 18 || y < 98 || y > height - 46;
    label.element.hidden = false;
    label.element.classList.toggle('is-edge', outside);
    label.element.style.transform = `translate3d(${x}px,${y}px,0)`;
  });
}

function frameModel() {
  if (!modelBounds) return;
  const center = modelBounds.getCenter(new THREE.Vector3());
  const radius = (sceneBounds || modelBounds).getSize(new THREE.Vector3()).length() / 2;
  const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.1;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(1, .65, -1.15).normalize(), distance);
  controls.maxDistance = Math.max(160, distance * 2.4);
  controls.update();
  sun.shadow.camera.left = -radius; sun.shadow.camera.right = radius;
  sun.shadow.camera.top = radius; sun.shadow.camera.bottom = -radius;
  sun.shadow.camera.updateProjectionMatrix();
}

function addFloorPlanFurniture(bounds) {
  const height = bounds.max.y - bounds.min.y;
  const firstFloorY = bounds.min.y + .12;
  const secondFloorY = bounds.min.y + height * .475;
  const group = new THREE.Group();
  group.name = '平面布置图新增家具';

  const furnitureMaterials = {
    top: new THREE.MeshStandardMaterial({ color: '#b7b5ae', roughness: .72, metalness: .03 }),
    frame: new THREE.MeshStandardMaterial({ color: '#3c474b', roughness: .44, metalness: .52 }),
    chair: new THREE.MeshStandardMaterial({ color: '#667276', roughness: .8, metalness: .05 }),
    screen: new THREE.MeshStandardMaterial({ color: '#16282e', roughness: .28, metalness: .38 }),
    rack: new THREE.MeshStandardMaterial({ color: '#34454a', roughness: .5, metalness: .48 }),
    rackFace: new THREE.MeshStandardMaterial({ color: '#17252a', roughness: .34, metalness: .62 }),
  };
  Object.values(furnitureMaterials).forEach(material => {
    material.clippingPlanes = [sectionPlane, sectionFloorPlane];
    material.clipShadows = true;
    materials.push(material);
  });

  const box = (parent, size, position, material, name) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addChair = (parent, x, y, z, rotation = 0) => {
    const chair = new THREE.Group();
    chair.name = '办公椅';
    box(chair, [.48, .1, .48], [0, .46, 0], furnitureMaterials.chair, '椅座');
    box(chair, [.48, .55, .09], [0, .77, .2], furnitureMaterials.chair, '椅背');
    box(chair, [.08, .42, .08], [0, .21, 0], furnitureMaterials.frame, '椅脚');
    chair.position.set(x, y, z);
    chair.rotation.y = rotation;
    parent.add(chair);
  };

  const addDesk = (parent, x, y, z, rotation = 0, withScreen = true) => {
    const desk = new THREE.Group();
    desk.name = '办公工位';
    box(desk, [1.35, .09, .68], [0, .73, 0], furnitureMaterials.top, '桌面');
    for (const legX of [-.52, .52]) {
      box(desk, [.07, .69, .07], [legX, .36, -.24], furnitureMaterials.frame, '桌腿');
      box(desk, [.07, .69, .07], [legX, .36, .24], furnitureMaterials.frame, '桌腿');
    }
    if (withScreen) {
      box(desk, [.55, .34, .045], [0, 1.01, -.12], furnitureMaterials.screen, '显示器');
      box(desk, [.07, .25, .07], [0, .83, -.12], furnitureMaterials.frame, '显示器支架');
    }
    desk.position.set(x, y, z);
    desk.rotation.y = rotation;
    parent.add(desk);
  };

  const addWorkstation = (parent, x, y, z, rotation = 0) => {
    addDesk(parent, x, y, z, rotation);
    const offset = new THREE.Vector3(0, 0, .78).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    addChair(parent, x + offset.x, y, z + offset.z, rotation + Math.PI);
  };

  const addMeetingRoom = (parent, x, y, z, length, seats, rotation = 0) => {
    const room = new THREE.Group();
    room.name = '会议室家具';
    box(room, [length, .1, 1.08], [0, .74, 0], furnitureMaterials.top, '会议桌');
    for (const legX of [-length * .36, length * .36]) {
      box(room, [.09, .68, .09], [legX, .36, 0], furnitureMaterials.frame, '会议桌腿');
    }
    const perSide = Math.ceil(seats / 2);
    for (let i = 0; i < perSide; i++) {
      const chairX = perSide === 1 ? 0 : -length * .36 + i * length * .72 / (perSide - 1);
      addChair(room, chairX, 0, -.92, 0);
      addChair(room, chairX, 0, .92, Math.PI);
    }
    room.position.set(x, y, z);
    room.rotation.y = rotation;
    parent.add(room);
  };

  const addRackRow = (parent, x, y, z, count, alongZ = true) => {
    for (let i = 0; i < count; i++) {
      const rack = new THREE.Group();
      rack.name = '设备机柜';
      box(rack, [.68, 1.92, .82], [0, .96, 0], furnitureMaterials.rack, '机柜柜体');
      box(rack, [.56, 1.65, .025], [0, .98, .423], furnitureMaterials.rackFace, '机柜面板');
      for (let slot = 0; slot < 6; slot++) {
        box(rack, [.42, .025, .012], [0, .54 + slot * .2, .44], furnitureMaterials.frame, '设备槽位');
      }
      rack.position.set(x + (alongZ ? 0 : i * .92), y, z + (alongZ ? i * 1.02 : 0));
      parent.add(rack);
    }
  };

  const firstFloor = new THREE.Group();
  firstFloor.name = '1F平面布置';
  addMeetingRoom(firstFloor, 10.75, firstFloorY, 1.6, 2.4, 4, Math.PI / 2);
  addMeetingRoom(firstFloor, 10.75, firstFloorY, -2.65, 2.4, 4, Math.PI / 2);
  addMeetingRoom(firstFloor, 2.1, firstFloorY, -.3, 2.8, 6, 0);
  addRackRow(firstFloor, 3.7, firstFloorY, -11.7, 4, false);
  addRackRow(firstFloor, 9.4, firstFloorY, -11.7, 4, false);
  addRackRow(firstFloor, 9.4, firstFloorY, -9.9, 4, false);
  group.add(firstFloor);

  const secondFloor = new THREE.Group();
  secondFloor.name = '2F平面布置';
  const deskXs = [-11.1, -8.2, -5.3, -1.6, 1.3, 4.2];
  const deskZs = [10.2, 7.25, 4.3, 1.35, -1.6];
  deskZs.forEach((z, row) => deskXs.forEach(x => {
    const rotation = row % 2 ? Math.PI : 0;
    addWorkstation(secondFloor, x, secondFloorY, z, rotation);
  }));
  for (const z of [-5.1, -7.8]) {
    for (const x of [-1.5, 1.4, 4.3]) addWorkstation(secondFloor, x, secondFloorY, z, z < -6 ? Math.PI : 0);
  }
  addMeetingRoom(secondFloor, 10.75, secondFloorY, 8.6, 3.25, 8, Math.PI / 2);
  addMeetingRoom(secondFloor, 10.75, secondFloorY, 2.25, 3.25, 8, Math.PI / 2);
  addRackRow(secondFloor, -2.6, secondFloorY, -11.6, 4, false);
  group.add(secondFloor);

  scene.add(group);
  viewport.dataset.floorPlanFurniture = '1F+2F';
}

async function loadModel() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('./vendor/examples/jsm/libs/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('./model/4-building.glb');
  modelRoot = gltf.scene;
  modelRoot.name = '4号楼建筑模型';
  modelRoot.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      material.clippingPlanes = [sectionPlane, sectionFloorPlane];
      material.clipShadows = true;
      if (!materials.includes(material)) materials.push(material);
    }
  });
  scene.add(modelRoot);
  const rawBounds = new THREE.Box3().setFromObject(modelRoot);
  const rawSize = rawBounds.getSize(new THREE.Vector3());
  const rawCenter = rawBounds.getCenter(new THREE.Vector3());
  const scale = 28 / Math.max(rawSize.x, rawSize.z);
  modelRoot.scale.setScalar(scale);
  modelRoot.position.set(-rawCenter.x * scale, .035 - rawBounds.min.y * scale, -rawCenter.z * scale);
  modelRoot.updateMatrixWorld(true);
  modelBounds = new THREE.Box3().setFromObject(modelRoot);
  sectionHeight = modelBounds.max.y;
  const microRoughness = makeMicroRoughnessTexture();
  const palette = {
    facade: new THREE.MeshPhysicalMaterial({ color: '#9da6a5', roughness: .76, roughnessMap: microRoughness, metalness: .04, clearcoat: .14, clearcoatRoughness: .7 }),
    roof: new THREE.MeshPhysicalMaterial({ color: '#263238', roughness: .82, roughnessMap: microRoughness, metalness: .1, clearcoat: .24, clearcoatRoughness: .6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#246d82', roughness: .06, metalness: .12, transmission: .04, thickness: .02, ior: 1.45, transparent: true, opacity: .42, depthWrite: false, side: THREE.DoubleSide, clearcoat: .65, clearcoatRoughness: .12, emissive: '#0a1c22', emissiveIntensity: 0 }),
    floor: new THREE.MeshPhysicalMaterial({ color: '#a7aaa7', roughness: .88, roughnessMap: microRoughness, metalness: .02 }),
    metal: new THREE.MeshPhysicalMaterial({ color: '#52636a', roughness: .3, metalness: .78, clearcoat: .18, clearcoatRoughness: .35 }),
    wood: new THREE.MeshPhysicalMaterial({ color: '#806047', roughness: .68, roughnessMap: microRoughness, metalness: .02, clearcoat: .08, clearcoatRoughness: .8 }),
    plant: new THREE.MeshPhysicalMaterial({ color: '#7fae70', roughness: .82, metalness: 0, side: THREE.DoubleSide, emissive: '#16351d', emissiveIntensity: .08 }),
    interior: new THREE.MeshPhysicalMaterial({ color: '#cdb99a', roughness: .7, roughnessMap: microRoughness, metalness: .02, emissive: '#ffac66', emissiveIntensity: 0 }),
  };
  glassMaterial = palette.glass;
  interiorMaterial = palette.interior;
  const classifyMaterial = node => {
    const names = [];
    for (let current = node; current; current = current.parent) names.push(current.name || '');
    const name = names.join(' ').toLowerCase();
    const bounds = new THREE.Box3().setFromObject(node);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const smallest = Math.min(size.x, size.y, size.z);
    const largest = Math.max(size.x, size.y, size.z);
    const buildingSize = modelBounds.getSize(new THREE.Vector3());
    const nodeName = (node.name || '').toLowerCase();
    const firstFloorGlassDoor = /^(rectangle42[4-7]|line037|line165|line166|line167)$/.test(nodeName);
    const firstFloorInteriorFloor = center.y < modelBounds.min.y + .35 && size.y < .2 && size.x > 1.5 && size.z > 1.5;
    const exteriorRod = /^a\d/.test(nodeName) && center.y > 7.75 && center.y < 8.12 && smallest < .12 && largest > 1.4 && largest < 2.2;
    const roofDetailRod = /^a\d/.test(nodeName) && center.y > 8.0 && center.y < 9.1 && largest < 1.2;
    const exteriorLouver = /^le\d/.test(nodeName) && center.y > 7.7 && center.y < 8.6 && largest > 1.5 && (Math.abs(center.x) > 13.1 || Math.abs(center.z) > 13.1);
    const roofTriangle = /^(rectangle2133406290|rectangle2133406291|line025|line053|line060|line061)$/.test(nodeName) || (/^zz\d/.test(nodeName) && center.y > 8.15 && center.y < 8.95 && size.x < 2.5 && size.z < 1.5 && size.y > .25);
    const roofMarkerZone = /^zz\d/.test(nodeName) && center.y > 8.1 && center.y < 9.1;
    const plantZone = center.x > -1.6 && center.x < 1.8 && center.z > -8.7 && center.z < -6.4 && center.y > 4.5 && center.y < 8.5 && largest < 2.5 && !/rectangle|line|ceiling|a\d|le\d/.test(nodeName);
    const exteriorPlant = /^xfds00(4[3-9]|50)/.test(nodeName);
    if (/^xfds0(5[3-9]|6[0-8])/.test(nodeName) || exteriorPlant || exteriorRod || roofDetailRod || exteriorLouver || roofTriangle || roofMarkerZone || plantZone) { node.visible = false; return 'facade'; }
    if (/sofa|pillow|poliform|3dfreehub|chair|table|desk|bed|cabinet|柜|沙发|桌|椅/.test(name)) return 'interior';
    if (firstFloorInteriorFloor) return 'floor';
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const sourceIsGlass = sourceMaterials.some(material => material?.transparent || material?.transmission > .05 || /glass|window|glaz|窗|玻璃/.test(material?.name || ''));
    if (firstFloorGlassDoor || sourceIsGlass || /window|glass|glaz|curtain|窗|玻璃|door|gate|门/.test(name)) return 'glass';
    if (size.x > buildingSize.x * .5 && size.z > buildingSize.z * .5 && size.y < buildingSize.y * .2 && bounds.max.y > modelBounds.max.y - 1.5) return 'roof';
    if (/ceiling|roof|屋面|顶|rectangle006|rectangle428|rectangle437|rectangle438|rectangle439|rectangle440|rectangle933|rectangle936|line001|line002|line003/.test(name) || (smallest < .13 && size.x > 2 && size.z > 2)) return 'roof';
    const detailObject = /line|无极|zz|le\d|xfds/i.test(name);
    const panelArea = [...[size.x * size.y, size.x * size.z, size.y * size.z]].sort((a, b) => b - a)[0];
    const dimensions = [size.x, size.y, size.z].sort((a, b) => a - b);
    const verticalPane = size.y > .55 && dimensions[1] > .22 && largest < 3.4;
    // The model exports several window faces as "line" objects. Detect broad vertical panes
    // before the linework fallback, while keeping narrow mullions and rails as metal.
    if (smallest < .12 && verticalPane && panelArea > .22) return 'glass';
    if (/(^| )line|(^| )linz/i.test(name)) return 'metal';
    if (/stair|rail|handrail|栏杆|楼梯/.test(name)) return 'metal';
    if (/wood|timber|木/.test(name)) return 'wood';
    return 'facade';
  };
  materials.length = 0;
  modelRoot.traverse(node => {
    if (!node.isMesh) return;
    const material = palette[classifyMaterial(node)];
    node.material = Array.isArray(node.material) ? node.material.map(() => material) : material;
    node.castShadow = true; node.receiveShadow = true;
    material.clippingPlanes = [sectionPlane, sectionFloorPlane];
    material.clipShadows = true;
    if (!materials.includes(material)) materials.push(material);
  });
  addFloorPlanFurniture(modelBounds);
  setupRoomLabels(modelBounds);
  const footprint = modelBounds.getSize(new THREE.Vector3());
  const baseSize = Math.max(14, Math.max(footprint.x, footprint.z) + 4);
  const baseTop = modelBounds.min.y;
  const baseThickness = 1.4;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(baseSize, baseThickness, baseSize),
    new THREE.MeshStandardMaterial({ color: '#4f5a5c', roughness: .9 }),
  );
  base.name = '4号楼悬浮混凝土底座';
  base.position.y = baseTop - baseThickness * .5;
  base.receiveShadow = true;
  scene.add(base);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(baseSize, .08, baseSize),
    new THREE.MeshStandardMaterial({ color: '#e1e0da', roughness: .96 }),
  );
  slab.name = '4号楼场地基面';
  slab.position.y = baseTop + .01;
  slab.receiveShadow = true;
  scene.add(slab);
  sceneBounds = modelBounds.clone().union(new THREE.Box3().setFromObject(base));
  for (const y of [2.4, 6.7]) {
    for (const [x, z] of [[-.28, -.18], [.18, -.16], [0, .2]]) {
      const light = new THREE.PointLight('#ffd7a0', .25, 10, 1.7);
      light.position.set(x * 28, y, z * 28);
      scene.add(light); interiorLights.push(light);
    }
  }
  frameModel();
  camera.updateMatrixWorld(true);
  setDefaultLighting(); updateSection();
  loading?.classList.add('finished');
  viewport.dataset.model = 'model/4-building.glb';
  viewport.dataset.meshes = String(materials.length);
  viewport.dataset.buildingBottom = String(modelBounds.min.y);
  viewport.dataset.baseTop = String(baseTop);
  sectionToggle.disabled = false;
  setRoomLabelMode('1F');
  viewport.dataset.loaded = 'true';
}

loadModel().catch(error => { console.error('4号楼模型加载失败', error); viewport.dataset.loaded = 'error'; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); frameModel(); });
renderer.setAnimationLoop(() => {
  if (cameraFlight) {
    const t = Math.min(1, (performance.now() - cameraFlight.start) / cameraFlight.duration);
    const eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(cameraFlight.from, cameraFlight.to, eased);
    controls.target.lerpVectors(cameraFlight.targetFrom, cameraFlight.target, eased);
    if (t === 1) cameraFlight = null;
  }
  controls.update();
  updateRoomLabels();
  renderer.render(scene, camera);
});
