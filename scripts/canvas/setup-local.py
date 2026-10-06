"""Provision only a local Canvas/IdP test environment; no production credentials printed."""
import argparse, json, pathlib, re, secrets, subprocess
parser=argparse.ArgumentParser()
parser.add_argument('--idp-config', required=True, type=pathlib.Path)
parser.add_argument('--container', default='canvas-web')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
envfile=root/'.env'
config=envfile.read_text()
if re.search(r'^NODE_ENV=production\s*$', config, re.M):
    raise SystemExit('This script only supports local development.')
if not args.idp_config.is_file(): raise SystemExit('Provide the existing local IdP authsources.php path.')
def rails(filename):
    r=subprocess.run(['docker','exec','-i',args.container,'bundle','exec','rails','runner','-'],input=(root/'scripts/canvas'/filename).read_text(),text=True,capture_output=True)
    if r.returncode:
        raise SystemExit('Local Canvas fixture setup failed. Inspect the local Canvas logs; no token output was printed.')
    return r.stdout
raw=rails('setup-local.rb')
match=re.search(r'FINANCEBOT_CONFIG=(.*)',raw)
if not match: raise SystemExit('Canvas did not return the expected local configuration.')
values=json.loads(match[1])
settings={'CANVAS_DOMAIN':'http://localhost','CANVAS_CLIENT_ID':values['client_id'],'CANVAS_CLIENT_SECRET':values['client_secret'],'CANVAS_REDIRECT_URI':'http://localhost:6118/api/canvas/callback','CANVAS_TOKEN_KEY':secrets.token_hex(32)}
for key,value in settings.items():
    if key=='CANVAS_TOKEN_KEY' and re.search(r'^CANVAS_TOKEN_KEY=.+',config,re.M): continue
    config=re.sub(r'^'+key+r'=.*\n?','',config,flags=re.M)
    config+='\n'+key+'='+value+'\n'
envfile.write_text(config)
users=[{'login':f'canvas_student_{i:02}','puid':f'FB-CANVAS-{i:04}','name':'Alex Chen' if i<=2 else f'Canvas Student {i:02}'} for i in range(1,21)]
source=args.idp_config.read_text();marker='// FinanceBot Canvas integration local fixtures'
if marker not in source:
    block='\n'+marker+'\n'
    for u in users:
        block+=f"$config['example-userpass']['users']['{u['login']}:{u['login']}'] = array('uid'=>array('{u['login']}'), 'cwlLoginName'=>array('{u['login']}'), 'ubcEduCwlPuid'=>array('{u['puid']}'), 'eduPersonAffiliation'=>array('student'), 'displayName'=>array('{u['name']}'), 'mail'=>array('{u['login']}@student.ubc.ca'));\n"
    args.idp_config.write_text(source+block)
out=root/'audit-results/canvas-integration';out.mkdir(parents=True,exist_ok=True)
roster=out/'fixture-students.json';roster.write_text(json.dumps(users))
subprocess.run(['docker','cp',str(roster),args.container+':/tmp/financebot-canvas-students.json'],check=True,capture_output=True)
raw=rails('seed-local.rb');match=re.search(r'FINANCEBOT_FIXTURES=(.*)',raw)
if not match: raise SystemExit('Canvas fixtures returned no result.')
(out/'fixtures.json').write_text(match[1])
print('Local Developer Key, dedicated teacher, 20 students and Canvas 101/102/201 fixtures are ready. Secrets are only in ignored .env.')
