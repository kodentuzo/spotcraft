# When personal data leaks

A personal data breach is any loss, leak or change of personal data you didn't intend: a stolen
key, a database dump in the wrong place, a server someone else got into. The GDPR gives you
**72 hours** from when you know of it to tell your supervisory authority, unless it is unlikely
to put anyone at risk (Art. 33). This page is a checklist, not legal advice.

## In the first hour

1. **Stop it.** Rotate what leaked: in the server's `.env`, `AGENT_TOKEN`, `AUTH_SECRET` (it
   signs everyone out), database passwords, the backup bucket's key, Cloudflare tokens. Redeploy
   Spotcraft. Turn off a deploy hook whose token leaked, in the app's settings.
2. **Keep what you need to understand it.** Don't delete the server or its logs yet. A Hetzner
   snapshot keeps the disk as it is.
3. **Write down what you know,** with times: what happened, when you noticed, what you did.

## Within 72 hours

Work out, as well as you can:

- **What data:** which apps, which tables, how many people. The Settings page's "What this
  instance does with personal data" lists what the platform holds; each app's own tables hold
  the rest.
- **Who could have it,** and whether it was protected. Backups in the bucket are encrypted
  only by the provider, and a leaked `auth` schema holds session tokens, which let someone act
  as those guests.
- **What could happen to the people:** for guests without an email, often little.

Then, unless the risk is unlikely, report to the supervisory authority set on the Settings
page, through its form. What you don't know yet can follow later. If the risk to people is
high, tell them too (Art. 34), plainly, in the app.

## Afterwards

Keep a record of every breach, reported or not: what happened, its effects, what you did
(Art. 33(5)). Fix what let it happen, and check the fix.
