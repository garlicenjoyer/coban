import * as THREE from 'three';
import { modelMesh, modelPart } from '../render/gameModel';

export class LanternView {
  private readonly model: THREE.Object3D;
  private readonly light = new THREE.PointLight(0xffbc72, 0, 17, 1.65);

  constructor(scene: THREE.Scene, props: THREE.Group) {
    this.model = modelPart(props, 'Hand lantern').clone();
    const body = modelMesh(this.model, 'Copper body and guards');
    body.material = body.material.clone();
    // Attenuate nearby point lights on the copper so its paint stays visible around the chamber.
    body.material.onBeforeCompile = (shader) => {
      const pointLight = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
      const lighting = THREE.ShaderChunk.lights_fragment_begin.replace(pointLight, `${pointLight}
        float lampDistance = length( pointLight.position - geometryPosition );
        directLight.color *= mix( 0.004, 1.0, smoothstep( 0.25, 0.5, lampDistance ) );`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lighting);
    };
    body.material.emissive.setHex(0x322116);
    const glass = modelMesh(this.model, 'Amber glass') as THREE.Mesh;
    glass.material = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffdcad });
    glass.castShadow = false;
    this.model.name = 'Shepherd’s lantern';
    this.model.visible = false;
    this.light.name = 'Lantern light';
    scene.add(this.model, this.light);
  }

  update(lit: boolean, hand: THREE.Vector3, yaw: number): void {
    this.model.visible = lit;
    this.light.intensity = lit ? 12 : 0;
    if (!lit) return;
    this.model.position.copy(hand);
    this.model.rotation.y = yaw;
    this.light.position.copy(hand);
    this.light.position.y -= 0.20;
  }
}
