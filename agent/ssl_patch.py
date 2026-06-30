"""Monkey-patch SSL-контекста thrift для подключения к Impala.

Сервер Impala использует устаревшие cipher suites, которые Python 3.10+
отклоняет по умолчанию (security level 2), что приводит к
``SSLV3_ALERT_HANDSHAKE_FAILURE``. Патч понижает SECLEVEL и отключает
проверку сертификата — приемлемо для внутренней сети за VPN.

Вызывать ``patch_thrift_ssl()`` ОДИН РАЗ до первого подключения к Impala.
"""
import ssl
import thrift.transport.TSSLSocket as _mod

_patched = False


def patch_thrift_ssl() -> None:
    global _patched
    if _patched:
        return

    _orig = _mod.TSSLSocket.__init__

    def _patched_init(self, *a, **kw):
        _orig(self, *a, **kw)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
        self._context = ctx

    _mod.TSSLSocket.__init__ = _patched_init
    _patched = True
