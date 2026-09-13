import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateMetaAtlas } from '../../../workflows/meta-atlas-check/evaluate.mjs';
import { validateAtlas } from '../src/index.mjs';
import { schemaErrors, validators } from '../src/schemas.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const examples=path.join(root,'spec-source','examples');
const validate=(validator,value)=>assert.equal(validator(value),true,JSON.stringify(schemaErrors(validator),null,2));

test('resolved normalized output satisfies its public schema',()=>{
  const result=validateAtlas(path.join(examples,'valid/cross-map'),{specificationRevision:'test'});
  assert.equal(result.valid,true);
  validate(validators.normalized,result.normalized);
});

test('validation results satisfy their public schema in every state',()=>{
  const completeValid=validateAtlas(path.join(examples,'valid/minimal'),{specificationRevision:'test'});
  const completeInvalid=validateAtlas(path.join(examples,'invalid/empty-anchor-body'),{specificationRevision:'test'});
  const incomplete=validateAtlas(path.join(examples,'valid/minimal'),{profile:'neutral.atlas-validator.unsupported',specificationRevision:'test'});
  for(const result of [completeValid,completeInvalid,incomplete])validate(validators.validationResult,result.toJSON());
});

test('fixture manifest satisfies its public schema',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(examples,'manifest.json'),'utf8'));
  validate(validators.fixtureManifest,manifest);
});

test('publication profile front matter satisfies its public schema',()=>{
  validate(validators.publication,{
    type:'publication',
    id:'public',
    title:'Public fixture',
    summary:'Explicit fixture source selection.',
    selection:{atlas:true,maps:['one'],points:{'service-boundary':['one']},resources:['overview'],checks:['review']},
  });
});

test('normalized publication profile satisfies the public output schema',()=>{
  const result=validateAtlas(path.join(examples,'valid/publication-profile'),{specificationRevision:'test'});
  assert.equal(result.valid,true);
  const profile=result.normalized.publicationProfiles[0];
  assert.equal(profile.id,'public');
  validate(validators.normalized,result.normalized);
});

test('Meta-Atlas Check evaluation satisfies its public schema',()=>{
  const result=evaluateMetaAtlas(path.join(root,'meta-atlas'),{baseline:'test'});
  validate(validators.checkEvaluation,result);
  const activeRequired=result.evaluations.find(item=>item.status==='active'&&item.level==='required');
  const overclaim=structuredClone(result);
  overclaim.evaluations.find(item=>item.check===activeRequired.check).outcome='not-applicable';
  assert.equal(validators.checkEvaluation(overclaim),false);
  const unevidenced=structuredClone(result);
  unevidenced.evaluations.find(item=>item.check===activeRequired.check).evidence=[];
  assert.equal(validators.checkEvaluation(unevidenced),false);
});
