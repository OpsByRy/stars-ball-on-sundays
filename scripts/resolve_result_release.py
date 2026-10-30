"""Resolve the exact result commit from a trusted same-repository workflow receipt."""
import argparse
import json
from pathlib import Path
import re
import subprocess


def validate_receipt(receipt,base_sha,repository='OpsByRy/stars-ball-on-sundays'):
    if set(receipt)!={'schemaVersion','repository','branch','baseSHA','sourceSHA'}:raise ValueError('Unexpected release receipt fields')
    if receipt['schemaVersion']!='sbos-result-release-1' or receipt['repository']!=repository or receipt['branch']!='main':raise ValueError('Untrusted result receipt')
    if receipt['baseSHA']!=base_sha or not re.fullmatch('[0-9a-f]{40}',base_sha):raise ValueError('Result workflow starting SHA differs')
    if not re.fullmatch('[0-9a-f]{40}',receipt['sourceSHA']):raise ValueError('Invalid result commit SHA')
    return receipt['sourceSHA']


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('receipt',type=Path);parser.add_argument('--base-sha',required=True);args=parser.parse_args()
    sha=validate_receipt(json.loads(args.receipt.read_text()),args.base_sha)
    subprocess.run(['git','fetch','--no-tags','origin',sha],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['git','merge-base','--is-ancestor',args.base_sha,sha],check=True)
    subprocess.run(['git','checkout','--detach',sha],check=True,stdout=subprocess.DEVNULL)
    print('Checked out trusted result commit '+sha)
