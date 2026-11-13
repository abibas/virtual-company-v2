import { describe, expect, it } from 'vitest';
import { confluenceBody, jiraBody } from '../src/body.ts';
import { adf } from './fixtures/fetch.ts';

describe('bodies as each product takes them', () => {
  it('gives Jira ADF: from Markdown, or ADF’s JSON checked; never HTML', () => {
    expect(jiraBody({ format: 'markdown', text: 'Hi' })).toEqual(adf('Hi'));
    expect(jiraBody({ format: 'adf', text: JSON.stringify(adf('Hi')) })).toEqual(adf('Hi'));
    expect(() => jiraBody({ format: 'adf', text: '{"type":"paragraph"}' })).toThrow(/ADF is a JSON document/);
    expect(() => jiraBody({ format: 'adf', text: 'not json' })).toThrow(/ADF is a JSON document/);
    expect(() => jiraBody({ format: 'html', text: '<p>x</p>' })).toThrow(/Jira takes Markdown or ADF/);
  });

  it('gives Confluence its storage format for HTML, else ADF', () => {
    expect(confluenceBody({ format: 'html', text: '<p>x</p>' })).toEqual({
      representation: 'storage',
      value: '<p>x</p>',
    });
    expect(confluenceBody({ format: 'markdown', text: 'Hi' })).toEqual({
      representation: 'atlas_doc_format',
      value: JSON.stringify(adf('Hi')),
    });
    const given = JSON.stringify(adf('Mine'));
    expect(confluenceBody({ format: 'adf', text: given })).toEqual({
      representation: 'atlas_doc_format',
      value: given,
    });
    expect(() => confluenceBody({ format: 'adf', text: 'null' })).toThrow(/ADF is a JSON document/);
  });
});
