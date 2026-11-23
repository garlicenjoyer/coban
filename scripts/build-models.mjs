import { mkdir, writeFile } from 'node:fs/promises';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { sheepScenes, dogModel } from './animal-models.mjs';
import { motorcycleModel } from './motorcycle-model.mjs';
import { wolfModel } from './wolf-model.mjs';
import { yardProps } from './yard-props.mjs';
import { fieldProps } from './field-props.mjs';
import { villageModels } from './village-models.mjs';
import { valleyLifeModels } from './valley-life-models.mjs';

// GLTFExporter uses the browser FileReader API for binary glTF serialization.
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const output = new URL('../public/models/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, build] of [
  ['aegean-sheep', sheepScenes],
  ['karabas', dogModel],
  ['anatolian-wolf', wolfModel],
  ['valley-props', yardProps],
  ['field-props', fieldProps],
  ['village', villageModels],
  ['valley-life', valleyLifeModels],
  ['field-motorcycle', () => motorcycleModel({ wheelRadius: 0.30, cgFromRear: 0.62, wheelbase: 1.35 })],
]) {
  if (process.argv[2] && name !== process.argv[2]) continue;
  const buffer = await new GLTFExporter().parseAsync(build(), { binary: true });
  await writeFile(new URL(`${name}.glb`, output), new Uint8Array(buffer));
}
