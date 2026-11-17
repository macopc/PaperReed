#!/usr/bin/env python3
"""Probe Gmail over the current system route; no credentials, mail or proxy changes."""
import concurrent.futures
import json
import socket
import ssl


def probe(host, port, tls):
    stage = 'tcp-connect'
    result = {'host': host, 'port': port}
    try:
        with socket.create_connection((host, port), timeout=8) as connection:
            if tls:
                stage = 'tls-handshake'
                with ssl.create_default_context().wrap_socket(connection, server_hostname=host) as secure:
                    result['tls'] = secure.version()
                    stage = 'greeting'
                    greeting = secure.recv(1024)
            else:
                stage = 'greeting-before-starttls'
                greeting = connection.recv(1024)
            expected = b'* OK' if port == 993 else b'220'
            if not greeting.startswith(expected):
                raise RuntimeError('EOF before greeting' if not greeting else 'Unexpected greeting')
            result['ok'] = True
    except (OSError, RuntimeError) as error:
        result.update(ok=False, stage=stage, error=type(error).__name__, detail=str(error))
    return result


if __name__ == '__main__':
    # 587 deliberately checks the greeting first: STARTTLS cannot begin without it.
    targets = [('imap.gmail.com', 993, True), ('smtp.gmail.com', 465, True), ('smtp.gmail.com', 587, False)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda target: probe(*target), targets))
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if all(row['ok'] for row in results) else 1)
