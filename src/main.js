import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- Настройка сцены, камеры и рендерера ---
const scene = new THREE.Scene();
// --- Звёздное небо ---
function createStars(numStars = 2000, radius = 80) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < numStars; i++) {
    // Случайная точка на сфере
    const theta = Math.random() * 2 * Math.PI;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius + Math.random() * 10; // небольшой разброс
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    positions.push(x, y, z);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, sizeAttenuation: true });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}
createStars();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Освещение ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
scene.add(ambientLight);
// const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
// directionalLight.position.set(5, 3, 5);
// scene.add(directionalLight);

// --- Создание сферы Земли ---
const sphereGeometry = new THREE.SphereGeometry(5, 64, 64);
const sphereMaterial = new THREE.MeshPhongMaterial({
  color: 0x29105c, // Цвет океанов
  shininess: 5,
});
const earth = new THREE.Mesh(sphereGeometry, sphereMaterial);
scene.add(earth);

// --- Камера и контроллер ---
camera.position.z = 10;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 5.15; // минимальное расстояние от центра (радиус сферы + небольшой зазор)
controls.maxDistance = 50; // максимальное расстояние

// Динамическое уменьшение скорости зума при приближении
const baseZoomSpeed = 10.0;
const baseRotateSpeed = 7;
controls.rotateSpeed = baseZoomSpeed;
controls.addEventListener('start', () => {
  // Чем ближе к поверхности, тем меньше скорость
  const dist = camera.position.length();
  controls.zoomSpeed = Math.max(0.01, baseZoomSpeed * (dist - controls.minDistance) / (controls.maxDistance - controls.minDistance));
  controls.rotateSpeed = Math.max(0.01, baseRotateSpeed * (dist - controls.minDistance) / (controls.maxDistance - controls.minDistance));
});

const countriesGroup = new THREE.Group();
earth.add(countriesGroup);

// --- Загрузка и отрисовка GeoJSON ---
fetch('https://unpkg.com/world-atlas@2/countries-50m.json')
  .then(res => res.json())
  .then(worldData => {
    const countries = topojson.feature(worldData, worldData.objects.countries);

    // --- Создание материала для стран ---
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0x99ccff, emissive: 0x99ccff, emissiveIntensity: .1 }); // Цвет границ

    // --- Преобразование GeoJSON в 3D-объекты ---
    countries.features.forEach((country, index) => {
      const geo = country.geometry;
      if (geo) {
        const mesh = geoJsonTo3d(geo, lineMaterial);
        countriesGroup.add(mesh);
      }
    });
  });

// --- Загрузка и визуализация городов ---
// --- Для интерактивного окна ---
let cityDataGlobal = [];
let infoDiv = null;
let cityCursor = null; // глобально
// --- Табличка загрузки ---
let loadingDiv = null;
function showLoading() {
  if (loadingDiv) return;
  loadingDiv = document.createElement('div');
  loadingDiv.textContent = 'Загрузка, подождите...';
  loadingDiv.style.position = 'fixed';
  loadingDiv.style.top = '50%';
  loadingDiv.style.left = '50%';
  loadingDiv.style.transform = 'translate(-50%, -50%)';
  loadingDiv.style.background = 'rgba(30,30,30,0.95)';
  loadingDiv.style.color = '#fff';
  loadingDiv.style.padding = '24px 40px';
  loadingDiv.style.borderRadius = '12px';
  loadingDiv.style.fontSize = '1.3em';
  loadingDiv.style.fontFamily = 'sans-serif';
  loadingDiv.style.zIndex = '2000';
  document.body.appendChild(loadingDiv);
}
function hideLoading() {
  if (loadingDiv) {
    loadingDiv.remove();
    loadingDiv = null;
  }
}
// --- Оптимизированная визуализация городов (объединение геометрии) ---
async function loadCities() {
  showLoading();
  fetch('worldcities.json')
    .then(res => res.json())
    .then(citiesData => {
      hideLoading();
      cityDataGlobal = citiesData;
      const cities = citiesData;
      // Визуализация городов:
      const axis = new THREE.Vector3(0, 1, 0);
      const geometries = [];
      cities.forEach(city => {
        // Преобразуем координаты в 3D
        const phi = (90 - city.lat) * (Math.PI / 180);
        const theta = (city.lng + 180) * (Math.PI / 180);
        const radius = 5.01;
        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const y = radius * Math.cos(phi);
        const z = radius * Math.sin(phi) * Math.sin(theta);

        // Нормализация населения
        const minPop = 1000;
        const maxPop = 40000000;
        const pop = city.population || minPop;
        const popNorm = pop / maxPop;

        // Высота столбика
        const minHeight = 0.01;
        const maxHeight = 0.6;
        const height = minHeight + (maxHeight - minHeight) * popNorm;

        // Ширина столбика
        const minRadius = 0.001;
        const maxRadius = 0.03;
        const radiusCyl = minRadius + (maxRadius - minRadius) * popNorm;

        // Цвет по порогам населения
        let color;
        if (pop > 10000000) {
          color = new THREE.Color(0xB22222); // алый красный
        } else if (pop > 1000000) {
          color = new THREE.Color(0xff0000); // красный
        } else if (pop > 500000) {
          color = new THREE.Color(0xff6f00); // оранжевый
        } else if (pop > 100000) {
          color = new THREE.Color(0xd9ff00); // жёлтый
        } else if (pop > 1000) {
          color = new THREE.Color(0x00ff00); // зелёный
        } else {
          color = new THREE.Color(0x8a2be2); // фиолетовый
        }

        // Вектор направления от центра
        const dir = new THREE.Vector3(x, y, z).normalize();
        // Матрица поворота цилиндра вдоль радиуса
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, dir);
        // Матрица смещения столбика на поверхность
        const translation = new THREE.Matrix4().makeTranslation(x + dir.x * height / 2, y + dir.y * height / 2, z + dir.z * height / 2);

        // Создаём цилиндр и применяем трансформации
        const geometry = new THREE.CylinderGeometry(radiusCyl, radiusCyl, height, 12);
        geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
        geometry.applyMatrix4(translation);
        geometry.userData = { color: color.getHex() };
        geometries.push(geometry);
      });
      const mergedGeometry = mergeGeometries(geometries, false);
      const colors = [];
      geometries.forEach(geo => {
        const colorHex = geo.userData?.color || 0xffffff;
        for (let i = 0; i < geo.attributes.position.count; i++) {
          colors.push((colorHex >> 16 & 255) / 255, (colorHex >> 8 & 255) / 255, (colorHex & 255) / 255);
        }
      });
      mergedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      const mergedMesh = new THREE.Mesh(mergedGeometry, material);
      earth.add(mergedMesh);
      // --- Обработка клика по карте ---
      renderer.domElement.addEventListener('pointerdown', onEarthClickOn);
      renderer.domElement.addEventListener('pointerup', onEarthClick);

      let x, y;

      function onEarthClickOn(event) {
        x = event.clientX;
        y = event.clientY;
      }

      function onEarthClick(event) {

        if (event.clientX !== x || event.clientY !== y) return;

        // Получаем координаты клика
        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
        mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;

        // Пересечение с землёй
        const point = raySphereIntersection(camera, mouse, 5);

        // Ищем ближайший город в радиусе 10 км
        let minDist = Infinity;
        let nearestCity = null;
        for (const city of cityDataGlobal) {
          // Переводим координаты города в 3D
          const phi = (90 - city.lat) * (Math.PI / 180);
          const theta = (city.lng + 180) * (Math.PI / 180);
          const radius = 5.0;
          const x = -(radius * Math.sin(phi) * Math.cos(theta));
          const y = radius * Math.cos(phi);
          const z = radius * Math.sin(phi) * Math.sin(theta);
          const cityPos = new THREE.Vector3(x, y, z);

          const searchRadius = 50;

          // Вычисляем расстояние в километрах
          const dist = point.distanceTo(cityPos) * (6371 / 5); // 6371 км радиус Земли
          if (dist < searchRadius && dist < minDist) {
            minDist = dist;
            nearestCity = { ...city, pos: cityPos };
          }
        }
        if (!nearestCity) {
          return;
        }

        if (cityCursor) {
          cityCursor.parent && cityCursor.parent.remove(cityCursor);
          cityCursor = null;
        }
        if (nearestCity) {
          console.log(point);
          const popNorm = (nearestCity.population || minPop) / 40000000;
          const height = (0.01 + (0.6 - 0.01) * popNorm) * 4;
          const cylRadius = 0.002 + (0.03 - 0.001) * popNorm;
          const cursorGeometry = new THREE.CylinderGeometry(cylRadius, cylRadius, height, 12);
          const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
          const axis = new THREE.Vector3(0, -1, 0);
          const dir = nearestCity.pos.clone().normalize();
          const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, dir);
          cursorGeometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
          cityCursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
          cityCursor.position.copy(nearestCity.pos);
          earth.add(cityCursor);
        }

        console.log(point.length());

        // Удаляем старое окно
        if (infoDiv) infoDiv.remove();

        // Создаём div
        infoDiv = document.createElement('div');
        infoDiv.style.position = 'absolute';
        infoDiv.style.background = 'rgba(255,255,255,0.95)';
        infoDiv.style.border = '1px solid #888';
        infoDiv.style.borderRadius = '8px';
        infoDiv.style.padding = '12px 18px 12px 18px';
        infoDiv.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
        infoDiv.style.zIndex = '1000';
        infoDiv.style.minWidth = '180px';
        infoDiv.style.fontFamily = 'sans-serif';

        // Кнопка закрытия
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✖';
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '6px';
        closeBtn.style.right = '8px';
        closeBtn.style.background = 'transparent';
        closeBtn.style.border = 'none';
        closeBtn.style.fontSize = '18px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => infoDiv.remove();
        infoDiv.appendChild(closeBtn);

        // Текстовая информация
        const nameDiv = document.createElement('div');
        nameDiv.innerHTML = `<b>${nearestCity.city}</b>`;
        infoDiv.appendChild(nameDiv);
        const countryDiv = document.createElement('div');
        countryDiv.textContent = nearestCity.country;
        infoDiv.appendChild(countryDiv);
        const popDiv = document.createElement('div');
        const population = nearestCity.population || "-";
        popDiv.textContent = `Население: ${population}`;
        infoDiv.appendChild(popDiv);

        // Позиция окна: над городом
        // Переводим 3D координаты города в экранные
        const cityScreen = nearestCity.pos.clone().project(camera);
        const sx = (cityScreen.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
        const sy = (-cityScreen.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
        infoDiv.style.left = `${sx}px`;
        infoDiv.style.top = `${sy}px`;

        document.body.appendChild(infoDiv);
      }
    });
}

loadCities();

// Функция для преобразования GeoJSON координат в 3D-линии
function geoJsonTo3d(geo, material) {
  const group = new THREE.Group();

  const convertCoordinates = (coords) => {
    // [долгота, широта] -> 3D точка на сфере
    const [lon, lat] = coords;
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const radius = 5; // тот же радиус, что и у сферы

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
  };

  if (geo.type === 'Polygon') {
    geo.coordinates.forEach(ring => {
      const points = ring.map(convertCoordinates);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(geometry, material));
    });
  } else if (geo.type === 'MultiPolygon') {
    geo.coordinates.forEach(polygon => {
      polygon.forEach(ring => {
        const points = ring.map(convertCoordinates);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        group.add(new THREE.Line(geometry, material));
      });
    });
  }

  return group;
}

function raySphereIntersection(camera, mouse, radius = 5.0) {
  // mouse: THREE.Vector2 с координатами [-1, 1]
  // camera: THREE.PerspectiveCamera
  // radius: радиус сферы

  // Получаем направление луча из камеры
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const origin = raycaster.ray.origin.clone();
  const dir = raycaster.ray.direction.clone().normalize();

  // Решаем квадратное уравнение для пересечения с центром (0,0,0)
  // (origin + dir * t)^2 = radius^2
  const a = dir.dot(dir);
  const b = 2 * origin.dot(dir);
  const c = origin.dot(origin) - radius * radius;
  const D = b * b - 4 * a * c;

  if (D < 0) return null; // нет пересечения

  // Берём ближайшее положительное t
  const t1 = (-b - Math.sqrt(D)) / (2 * a);
  const t2 = (-b + Math.sqrt(D)) / (2 * a);
  const t = t1 > 0 ? t1 : t2 > 0 ? t2 : null;
  if (t === null) return null;

  // Точка пересечения
  return origin.add(dir.multiplyScalar(t));
}

// --- Анимация ---
// --- Bloom postprocessing setup ---
const bloomLayer = new THREE.Layers();
bloomLayer.set(1);
const params = {
  exposure: 1,
  bloomStrength: 1.5,
  bloomThreshold: 0,
  bloomRadius: 0.5
};
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomStrength,
  params.bloomRadius,
  params.bloomThreshold
);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // Рендерим обычные объекты
  // Рендерим только bloom объекты
  renderer.render(scene, camera);
  // camera.layers.set(1);
  composer.render();
  // camera.layers.set(0);
}
animate();

// --- Обработка изменения размера окна ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});
