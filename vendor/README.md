# UBC LMS toolkit

`ubc-ubc-genai-toolkit-lms-integration-1.4.0.tgz` is built from the unmodified
source of https://github.com/ubc/ubc-genai-toolkit-lms-integration at commit
`2bf95b48c499d9e947abf8489349aa18df2fbeab` (GPL-3.0, as declared upstream).
The source was supplied locally by Stephen. GitHub Packages was unavailable
without npm registry authentication, so the application uses this portable,
lockfile-integrity-pinned package. No credentials or environment files are packed.

Build used TypeScript 5.4.5, @types/node 20, @types/express 4,
@types/express-session 1 and the upstream tsconfig.json. To reproduce: check out
the commit, install its development dependencies, run `npm run build`, then
`npm pack --ignore-scripts`. The tarball contains dist and upstream CHANGELOG;
source maps retain upstream filenames. Source and build configuration are
available at the pinned public repository commit above.
