import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const VIEW_DIRECTIONS = Object.freeze({
  iso: { direction: [0.92, -1.22, 1.02], up: [0, 0, 1] },
  top: { direction: [0, 0, 1], up: [0, 1, 0] },
  front: { direction: [0, -1, 0.16], up: [0, 0, 1] },
  right: { direction: [1, 0, 0.16], up: [0, 0, 1] },
});

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

/**
 * A small, self-contained Three.js scene for the board preview.
 * Geometry ownership is transferred to the preview: replacing a model disposes
 * the previous geometry.
 */
export class BoardPreview {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onContextLost = options.onContextLost || (() => {});
    this.dimensions = { length: 85, width: 56, thickness: 1.6 };
    this.view = 'iso';
    this.transition = null;
    this.disposed = false;
    this.mesh = null;
    this.edges = null;
    this.pendingFit = true;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(150, -180, 150);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.82;
    this.controls.panSpeed = 0.68;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 2600;
    this.controls.target.set(0, 0, 0.8);
    this.controls.update();
    this.controls.addEventListener('start', () => {
      this.transition = null;
    });

    this.material = new THREE.MeshStandardMaterial({
      color: 0x1a5f2a,
      roughness: 0.62,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });

    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x9dc7a6,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.createEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.onContextLost('WebGL 上下文已丢失，请刷新页面恢复 3D 预览。');
    });

    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  createEnvironment() {
    const hemisphere = new THREE.HemisphereLight(0xd8f1de, 0x070b08, 0.92);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xf1fff3, 1.65);
    key.position.set(110, -150, 220);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -190;
    key.shadow.camera.right = 190;
    key.shadow.camera.top = 190;
    key.shadow.camera.bottom = -190;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 650;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.04;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8bbd9a, 0.55);
    fill.position.set(-180, 110, 90);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x5b8d6c, 0.45);
    rim.position.set(-60, -160, 40);
    this.scene.add(rim);

    this.grid = new THREE.GridHelper(640, 64, 0x3c5a45, 0x1d2b22);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = 0.015;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.38;
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    const shadowMaterial = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: 0.34,
      transparent: true,
    });
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(620, 620), shadowMaterial);
    this.shadowPlane.position.z = -0.03;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
  }

  setColor(color) {
    this.material.color.set(color);
    this.edgeMaterial.color.set(color).lerp(new THREE.Color(0xffffff), 0.48);
  }

  setDimensions(length, width, thickness) {
    this.dimensions = {
      length: Number(length),
      width: Number(width),
      thickness: Number(thickness),
    };
    this.boardGroup.position.z = Math.max(0, this.dimensions.thickness / 2);
  }

  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {{length:number,width:number,thickness:number,fit?:boolean}} options
   */
  setGeometry(geometry, options = {}) {
    if (!geometry) return;

    if (this.mesh) {
      const oldGeometry = this.mesh.geometry;
      this.mesh.geometry = geometry;
      if (oldGeometry && oldGeometry !== geometry) oldGeometry.dispose();
    } else {
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.boardGroup.add(this.mesh);
    }

    if (this.edges) {
      this.edges.geometry.dispose();
      this.boardGroup.remove(this.edges);
      this.edges = null;
    }

    try {
      const edgeGeometry = new THREE.EdgesGeometry(geometry, 28);
      this.edges = new THREE.LineSegments(edgeGeometry, this.edgeMaterial);
      this.edges.renderOrder = 2;
      this.boardGroup.add(this.edges);
    } catch {
      // The model is still perfectly usable without the cosmetic outline.
    }

    this.setDimensions(options.length, options.width, options.thickness);
    const shouldFit = options.fit ?? this.pendingFit;
    if (shouldFit) {
      this.fitView(this.view, false);
      this.pendingFit = false;
    }
  }

  setView(view, animate = true) {
    if (!VIEW_DIRECTIONS[view]) return;
    this.view = view;
    this.fitView(view, animate);
  }

  fitView(view = this.view, animate = true) {
    const definition = VIEW_DIRECTIONS[view] || VIEW_DIRECTIONS.iso;
    const { length, width, thickness } = this.dimensions;
    const radius = Math.sqrt(length * length + width * width + thickness * thickness) / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.35, this.camera.aspect || 1);
    let distance = (radius / Math.sin(fov / 2)) * 1.17;
    if (aspect < 0.9) distance /= Math.max(0.55, aspect);

    const target = new THREE.Vector3(0, 0, thickness / 2);
    const direction = new THREE.Vector3(...definition.direction).normalize();
    const position = target.clone().addScaledVector(direction, Math.max(35, distance));
    const up = new THREE.Vector3(...definition.up);

    if (!animate) {
      this.camera.up.copy(up);
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
      return;
    }

    this.transition = {
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromUp: this.camera.up.clone(),
      toUp: up,
      start: performance.now(),
      duration: 380,
    };
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.pendingFit) {
      this.fitView(this.view, false);
      this.pendingFit = false;
    }
  }

  animate(now) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);

    if (this.transition) {
      const elapsed = Math.min(1, (now - this.transition.start) / this.transition.duration);
      const eased = smoothstep(elapsed);
      this.camera.position.lerpVectors(
        this.transition.fromPosition,
        this.transition.toPosition,
        eased,
      );
      this.controls.target.lerpVectors(
        this.transition.fromTarget,
        this.transition.toTarget,
        eased,
      );
      this.camera.up
        .lerpVectors(this.transition.fromUp, this.transition.toUp, eased)
        .normalize();
      if (elapsed >= 1) this.transition = null;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.edges) {
      this.edges.geometry.dispose();
      this.edges = null;
    }
    this.material.dispose();
    this.edgeMaterial.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.shadowPlane.geometry.dispose();
    this.shadowPlane.material.dispose();
    this.renderer.dispose();
  }
}
