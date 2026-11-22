// The student tools this site knows about. The teacher page shows these
// alongside the tools the teacher's inbox script says it accepts; the join
// page shows a button for each. To add a tool: add it here, and add a
// matching entry to TOOLS in apps-script/Classroom-Inbox.gs.

export const KNOWN_TOOLS = {
  pagepal: {
    name: 'PagePal',
    url: 'https://evandevon.github.io/PagePal/',
    icon: new URL('../icons/pagepal.png', import.meta.url).href,
    what: 'Worksheets: students read, type and talk on the page.',
    where: 'PagePal submissions › Class › Worksheet',
    connect: 'Settings › Scan class QR code',
  },
  'word-helper': {
    name: 'Word Helper',
    url: 'https://evandevon.github.io/Word_Helper/',
    icon: new URL('../icons/word-helper.svg', import.meta.url).href,
    what: 'Writing, with word suggestions, spelling help and read-aloud.',
    where: 'Word Helper submissions › Class',
    connect: 'Connect to my teacher',
  },
};

/** Known tools first (in table order), then any others the inbox accepts. */
export function toolList(accepted) {
  const keys = Object.keys(KNOWN_TOOLS);
  (accepted || []).forEach(k => { if (!keys.includes(k)) keys.push(k); });
  return keys.map(key => ({
    key,
    known: Object.prototype.hasOwnProperty.call(KNOWN_TOOLS, key),
    accepted: accepted ? accepted.includes(key) : null,
    ...(KNOWN_TOOLS[key] || { name: key, what: 'A tool this site doesn’t know yet.', where: 'Its own folder in Classroom Inbox' }),
  }));
}
