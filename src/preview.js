import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const VIEW_DIRECTIONS = Object.freeze({
  iso: { direction: [0.98, -1.28, 1.02], up: [0, 0, 1] },
  top: { direction: [0, 0, 1], up: [0, 1, 0] },
  front: { direction: [0, -1, 0], up: [0, 0, 1] },
  back: { direction: [0, 1, 0], up: [0, 0, 1] },
  left: { direction: [-1, 0, 0], up: [0, 0, 1] },
  right: { direction: [1, 0, 0], up: [0, 0, 1] },
});

const ORBIT_UP = new THREE.Vector3(0, 1, 0);

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function makeCylinder(radius, height, x, y, z, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  geometry.deleteAttribute('uv');
  return geometry;
}

/**
 * Three.js preview for an acrylic enclosure assembly. Geometry ownership is
 * transferred from the case builder to this class on setModel().
 */
export class BoardPreview {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onContextLost = options.onContextLost || (() => {});
    this.onViewChange = options.onViewChange || (() => {});
    this.bounds = { width: 95, depth: 66, height: 29.6, centerZ: 14.8 };
    this.view = 'iso';
    this.mode = 'dark';
    this.projection = 'perspective';
    this.orthographicViewHeight = 100;
    this.transition = null;
    this.exploded = false;
    this.explodeProgress = 0;
    this.explodeTarget = 0;
    this.explodeDistance = 28;
    this.panelEntries = [];
    this.disposed = false;
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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.perspectiveCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 6000);
    this.perspectiveCamera.up.set(0, 0, 1);
    this.perspectiveCamera.position.set(150, -190, 160);

    this.orthographicCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 6000);
    this.orthographicCamera.up.set(0, 0, 1);
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);
    this.orthographicCamera.zoom = 1;

    this.camera = this.perspectiveCamera;
    this.controls = null;
    this.orbitPointers = new Set();
    this.orbitGesture = null;
    this.setupControls(this.camera, new THREE.Vector3(0, 0, 14.8));
    this.bindOrbitStateSync();

    this.panelMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xbfe7e1,
      roughness: 0.14,
      metalness: 0.02,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
    });
    this.panelEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xa8e6dd,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.boardMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a5f2a,
      roughness: 0.62,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    this.steelMaterial = new THREE.MeshStandardMaterial({
      color: 0xc6d0d1,
      roughness: 0.3,
      metalness: 0.82,
    });
    this.brassMaterial = new THREE.MeshStandardMaterial({
      color: 0xb3955c,
      roughness: 0.36,
      metalness: 0.7,
    });

    this.assemblyGroup = new THREE.Group();
    this.scene.add(this.assemblyGroup);
    this.panelsGroup = new THREE.Group();
    this.hardwareGroup = new THREE.Group();
    this.boardGroup = new THREE.Group();
    this.assemblyGroup.add(this.panelsGroup, this.hardwareGroup, this.boardGroup);

    this.createEnvironment();
    this.setMode(this.mode);

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

  setupControls(camera, target) {
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.82;
    this.controls.panSpeed = 0.68;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3200;
    this.controls.minZoom = 0.08;
    this.controls.maxZoom = 24;
    this.controls.target.copy(target);
    this.controls.update();
    this.controls.addEventListener('start', () => {
      this.transition = null;
    });
  }

  bindOrbitStateSync() {
    this.handleOrbitPointerDown = (event) => {
      this.syncOrbitAxis();
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.orbitPointers.add(event.pointerId);
      if (this.orbitPointers.size > 1) {
        this.orbitGesture = null;
        return;
      }
      this.orbitGesture = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        changed: false,
      };
    };
    this.handleOrbitPointerMove = (event) => {
      const gesture = this.orbitGesture;
      if (!gesture || gesture.pointerId !== event.pointerId || gesture.changed) {
        return;
      }
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) {
        return;
      }
      gesture.changed = true;
      if (this.view !== 'iso') {
        this.view = 'iso';
        this.onViewChange('iso');
      }
    };
    this.handleOrbitPointerEnd = (event) => {
      this.orbitPointers.delete(event.pointerId);
      if (this.orbitGesture?.pointerId === event.pointerId) {
        this.orbitGesture = null;
      }
    };

    this.canvas.addEventListener('pointerdown', this.handleOrbitPointerDown);
    this.canvas.addEventListener('pointermove', this.handleOrbitPointerMove);
    this.canvas.addEventListener('pointerup', this.handleOrbitPointerEnd);
    this.canvas.addEventListener('pointercancel', this.handleOrbitPointerEnd);
  }

  syncOrbitAxis() {
    // OrbitControls caches the camera-up quaternion when it is constructed.
    // Top view changes the camera up axis, so refresh that cached axis before
    // OrbitControls handles the next drag.
    const controls = this.controls;
    if (!controls?._quat || !controls._quatInverse) return;
    controls._quat.setFromUnitVectors(this.camera.up, ORBIT_UP);
    controls._quatInverse.copy(controls._quat).invert();
  }

  createEnvironment() {
    const hemisphere = new THREE.HemisphereLight(0xd8f1de, 0x070b08, 1.05);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xf4fff5, 1.85);
    key.position.set(140, -180, 260);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -260;
    key.shadow.camera.right = 260;
    key.shadow.camera.top = 260;
    key.shadow.camera.bottom = -260;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 850;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.04;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8bbd9a, 0.55);
    fill.position.set(-220, 120, 130);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x6aa982, 0.65);
    rim.position.set(-80, -190, 80);
    this.scene.add(rim);

    this.grid = new THREE.GridHelper(800, 80, 0x3c5a45, 0x1d2b22);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = 0.015;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.32;
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.ShadowMaterial({
        color: 0x000000,
        opacity: 0.28,
        transparent: true,
      }),
    );
    this.shadowPlane.position.z = -0.03;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
  }

  setMode(mode) {
    this.mode = mode === 'light' ? 'light' : 'dark';
    const light = this.mode === 'light';
    this.panelMaterial.color.set(light ? 0xb9e2db : 0xbfe7e1);
    this.panelMaterial.opacity = light ? 0.22 : 0.18;
    this.panelEdgeMaterial.color.set(light ? 0x2f766a : 0xa8e6dd);
    this.panelEdgeMaterial.opacity = light ? 0.72 : 0.58;
    if (this.grid) this.grid.material.opacity = light ? 0.2 : 0.32;
    if (this.shadowPlane) this.shadowPlane.material.opacity = light ? 0.18 : 0.28;
  }

  getVisibleHeight() {
    if (this.projection === 'orthographic') {
      return (this.orthographicCamera.top - this.orthographicCamera.bottom) /
        Math.max(0.001, this.orthographicCamera.zoom);
    }
    const distance = this.camera.position.distanceTo(this.controls.target);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    return 2 * distance * Math.tan(fov / 2);
  }

  updateOrthoFrustum() {
    const aspect = Math.max(0.2, this.perspectiveCamera.aspect || 1);
    const height = Math.max(8, this.orthographicViewHeight);
    const width = height * aspect;
    const camera = this.orthographicCamera;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }

  /**
   * Switch between perspective and orthographic (parallel) projection while
   * preserving the current camera direction, target and apparent scale.
   */
  setProjection(mode) {
    const next = mode === 'orthographic' ? 'orthographic' : 'perspective';
    if (next === this.projection) return this.projection;

    const target = this.controls.target.clone();
    const direction = this.camera.position.clone().sub(target);
    if (direction.lengthSq() < 1e-8) direction.set(1, -1.2, 1);
    direction.normalize();
    const visibleHeight = Math.max(10, this.getVisibleHeight());
    const up = this.camera.up.clone();
    this.transition = null;

    if (next === 'orthographic') {
      const distance = Math.max(60, this.camera.position.distanceTo(target));
      this.orthographicViewHeight = visibleHeight;
      this.orthographicCamera.zoom = 1;
      this.orthographicCamera.up.copy(up);
      this.orthographicCamera.position.copy(target).addScaledVector(direction, distance);
      this.orthographicCamera.lookAt(target);
      this.updateOrthoFrustum();
      this.camera = this.orthographicCamera;
      this.projection = 'orthographic';
      this.setupControls(this.camera, target);
    } else {
      const fov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov);
      const distance = Math.max(20, visibleHeight / (2 * Math.tan(fov / 2)));
      this.perspectiveCamera.up.copy(up);
      this.perspectiveCamera.position.copy(target).addScaledVector(direction, distance);
      this.perspectiveCamera.lookAt(target);
      this.camera = this.perspectiveCamera;
      this.projection = 'perspective';
      this.setupControls(this.camera, target);
    }

    return this.projection;
  }

  setBoardColor(color) {
    this.boardMaterial.color.set(color);
  }

  setModel(model, options = {}) {
    if (!model) return;
    this.clearAssembly();
    this.bounds = {
      width: model.dimensions.outerWidth,
      depth: model.dimensions.outerDepth,
      height: model.dimensions.outerHeight,
      centerZ: model.dimensions.outerHeight / 2,
    };
    this.explodeDistance = Math.max(24, Math.min(this.bounds.width, this.bounds.depth) * 0.28);

    for (const panel of model.panels) {
      const mesh = new THREE.Mesh(panel.geometry, this.panelMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 3;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(panel.geometry, 24),
        this.panelEdgeMaterial,
      );
      edges.renderOrder = 4;
      const group = new THREE.Group();
      group.add(mesh, edges);
      this.panelsGroup.add(group);
      this.panelEntries.push({
        group,
        mesh,
        edges,
        direction: panel.explosion,
      });
    }

    this.boardMesh = new THREE.Mesh(model.board.geometry, this.boardMaterial);
    this.boardMesh.position.z = model.board.z;
    this.boardMesh.castShadow = true;
    this.boardMesh.receiveShadow = true;
    this.boardGroup.add(this.boardMesh);

    for (const standoff of model.hardware.lowerStandoffs) {
      const mesh = new THREE.Mesh(
        makeCylinder(standoff.radius, standoff.height, standoff.x, standoff.y, standoff.z, 6),
        this.brassMaterial,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.hardwareGroup.add(mesh);
    }
    for (const standoff of model.hardware.upperStandoffs) {
      const mesh = new THREE.Mesh(
        makeCylinder(standoff.radius, standoff.height, standoff.x, standoff.y, standoff.z, 6),
        this.brassMaterial,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.hardwareGroup.add(mesh);
    }
    for (const shaft of model.hardware.connectorShafts) {
      const mesh = new THREE.Mesh(
        makeCylinder(shaft.radius, shaft.height, shaft.x, shaft.y, shaft.z, 16),
        this.steelMaterial,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.hardwareGroup.add(mesh);
    }
    for (const screw of model.hardware.screwHeads) {
      const mesh = new THREE.Mesh(
        makeCylinder(screw.radius, screw.height, screw.x, screw.y, screw.z, 24),
        this.steelMaterial,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.hardwareGroup.add(mesh);
    }

    this.applyExplosion();
    const shouldFit = options.fit ?? this.pendingFit;
    if (shouldFit) {
      this.fitView(this.view, false);
      this.pendingFit = false;
    }
  }

  clearAssembly() {
    for (const entry of this.panelEntries) {
      entry.group.remove(entry.mesh, entry.edges);
      entry.mesh.geometry.dispose();
      entry.edges.geometry.dispose();
    }
    this.panelEntries = [];
    this.panelsGroup.clear();

    if (this.boardMesh) {
      this.boardGroup.remove(this.boardMesh);
      this.boardMesh.geometry.dispose();
      this.boardMesh = null;
    }

    this.hardwareGroup.traverse((object) => {
      if (object.isMesh) object.geometry.dispose();
    });
    this.hardwareGroup.clear();
  }

  setExploded(exploded) {
    this.exploded = Boolean(exploded);
    this.explodeTarget = this.exploded ? 1 : 0;
  }

  applyExplosion() {
    for (const entry of this.panelEntries) {
      const scale = this.explodeProgress * this.explodeDistance;
      entry.group.position.set(
        entry.direction[0] * scale,
        entry.direction[1] * scale,
        entry.direction[2] * scale,
      );
    }
  }

  setView(view, animate = true) {
    if (!VIEW_DIRECTIONS[view]) return;
    this.view = view;
    this.fitView(view, animate);
  }

  getCameraState() {
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    return {
      projection: this.projection,
      view: this.view,
      direction: direction.toArray(),
      up: this.camera.up.toArray(),
      target: this.controls.target.toArray(),
      position: this.camera.position.toArray(),
      distance: this.camera.position.distanceTo(this.controls.target),
    };
  }

  fitView(view = this.view, animate = true) {
    const definition = VIEW_DIRECTIONS[view] || VIEW_DIRECTIONS.iso;
    const { width, depth, height, centerZ } = this.bounds;
    const radius =
      Math.sqrt(width * width + depth * depth + height * height) / 2;
    const fov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov);
    const aspect = Math.max(0.35, this.perspectiveCamera.aspect || 1);
    let perspectiveDistance = (radius / Math.sin(fov / 2)) * 1.25;
    if (aspect < 0.9) perspectiveDistance /= Math.max(0.55, aspect);

    const target = new THREE.Vector3(0, 0, centerZ);
    const direction = new THREE.Vector3(...definition.direction).normalize();
    const up = new THREE.Vector3(...definition.up);
    const orthographic = this.projection === 'orthographic';
    const visibleHeight = orthographic
      ? 2 * perspectiveDistance * Math.tan(fov / 2)
      : 0;
    const positionDistance = orthographic
      ? Math.max(70, perspectiveDistance)
      : Math.max(45, perspectiveDistance);
    const position = target.clone().addScaledVector(direction, positionDistance);

    if (!animate) {
      this.camera.up.copy(up);
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      if (orthographic) {
        this.orthographicCamera.zoom = 1;
        this.orthographicViewHeight = visibleHeight;
        this.updateOrthoFrustum();
      }
      this.camera.lookAt(target);
      this.syncOrbitAxis();
      this.controls.update();
      return;
    }

    const fromTarget = this.controls.target.clone();
    const fromPosition = this.camera.position.clone();
    const fromDirection = fromPosition.clone().sub(fromTarget);
    const fromDistance = Math.max(0.001, fromDirection.length());
    if (fromDirection.lengthSq() < 1e-8) {
      fromDirection.copy(direction);
    } else {
      fromDirection.normalize();
    }

    const dot = THREE.MathUtils.clamp(fromDirection.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const axis = new THREE.Vector3().crossVectors(fromDirection, direction);
    if (axis.lengthSq() < 1e-8) {
      // Opposite views (front/back, left/right) need an explicit orbit axis;
      // otherwise they would pass through the model centre.
      axis.copy(this.camera.up).normalize();
      if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
    } else {
      axis.normalize();
    }

    this.transition = {
      fromDirection,
      axis,
      angle,
      fromTarget,
      toTarget: target,
      fromDistance,
      toDistance: position.distanceTo(target),
      fromUp: this.camera.up.clone(),
      toUp: up,
      fromHeight: orthographic ? this.orthographicViewHeight : undefined,
      toHeight: orthographic ? visibleHeight : undefined,
      start: performance.now(),
      duration: 300 + (angle / Math.PI) * 320,
    };
    if (orthographic) this.orthographicCamera.zoom = 1;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthoFrustum();
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
      const distance =
        this.transition.fromDistance +
        (this.transition.toDistance - this.transition.fromDistance) * eased;

      this.controls.target.lerpVectors(
        this.transition.fromTarget,
        this.transition.toTarget,
        eased,
      );
      this.camera.position
        .copy(this.transition.fromDirection)
        .applyAxisAngle(this.transition.axis, this.transition.angle * eased)
        .multiplyScalar(distance)
        .add(this.controls.target);
      this.camera.up
        .lerpVectors(this.transition.fromUp, this.transition.toUp, eased)
        .normalize();
      if (this.transition.fromHeight !== undefined) {
        this.orthographicViewHeight =
          this.transition.fromHeight +
          (this.transition.toHeight - this.transition.fromHeight) * eased;
        this.updateOrthoFrustum();
      }
      if (elapsed >= 1) {
        this.transition = null;
        this.syncOrbitAxis();
      }
    }

    if (Math.abs(this.explodeProgress - this.explodeTarget) > 0.001) {
      this.explodeProgress +=
        (this.explodeTarget - this.explodeProgress) * 0.14;
      this.applyExplosion();
    } else if (this.explodeProgress !== this.explodeTarget) {
      this.explodeProgress = this.explodeTarget;
      this.applyExplosion();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handleOrbitPointerDown);
    this.canvas.removeEventListener('pointermove', this.handleOrbitPointerMove);
    this.canvas.removeEventListener('pointerup', this.handleOrbitPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.handleOrbitPointerEnd);
    this.controls.dispose();
    this.clearAssembly();
    this.panelMaterial.dispose();
    this.panelEdgeMaterial.dispose();
    this.boardMaterial.dispose();
    this.steelMaterial.dispose();
    this.brassMaterial.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.shadowPlane.geometry.dispose();
    this.shadowPlane.material.dispose();
    this.renderer.dispose();
  }
}
