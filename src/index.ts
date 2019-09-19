// native
import fs from 'fs';
import https from 'https';
import { resolve } from 'path';
import { parse, URL } from 'url';
import { promisify } from 'util';

// packages
import { extract } from 'tar';
import hostedGitInfo from 'hosted-git-info';
import { OutgoingHttpHeaders } from 'http';

const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);

async function ensureDirIsEmpty(dir: string) {
  try {
    const files = await readdir(dir);

    if (files.length > 0) {
      throw new Error(
        `The output directory already contains files (${resolve(dir)})`
      );
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function ensureDir(dir: string) {
  try {
    await mkdir(dir);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function downloadTarball(url: string | URL, type: string, dest: string) {
  return new Promise((resolve, reject) => {
    const headers = {} as OutgoingHttpHeaders;

    if (['github', 'gist'].includes(type) && process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }

    // we have to do this to support Node 8
    const parts = parse(url.toString());

    https
      .get({ headers, ...parts }, res => {
        const code = res.statusCode;

        if (!code || code >= 400) {
          return reject({ code, message: res.statusMessage });
        }
        if (code >= 300) {
          return downloadTarball(res.headers.location as string, type, dest)
            .then(resolve)
            .catch(reject);
        }

        const extractor = extract({ cwd: dest, strip: 1 });

        res
          .pipe(extractor)
          .on('finish', resolve)
          .on('error', reject);
      })
      .on('error', reject);
  });
}

interface CreateCloneOptions {
  force?: boolean;
}

export async function createClone(
  repoPath: string,
  dest: string,
  { force = false }: CreateCloneOptions = {}
) {
  const info = hostedGitInfo.fromUrl(repoPath);
  const urlToTarball = info.tarball();

  if (!urlToTarball) {
    throw new Error(
      'Unable to determine where to download the archive for this repository'
    );
  }

  const url = new URL(urlToTarball);
  const type = info.type;

  // make sure the directory exists
  await ensureDir(dest);

  if (!force) {
    // make sure the directory has nothing in it
    await ensureDirIsEmpty(dest);
  }

  // download the repo into the directory
  await downloadTarball(url, type, dest);
}
