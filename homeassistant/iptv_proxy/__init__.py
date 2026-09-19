"""Relais HTTP pour Lecteur IPTV.

Contourne le blocage « contenu mixte » d'un navigateur (la PWA, servie en
https:// par GitHub Pages, ne peut pas joindre directement un serveur IPTV
en http:// — restriction fixe de tous les navigateurs, voir www/net.js) en
relayant la requête depuis Home Assistant, lui-même joignable en https://
via Nabu Casa.

Réutilise l'authentification standard de Home Assistant (jeton d'accès
longue durée) plutôt qu'un secret séparé à gérer : c'est le même jeton que
www/hasync.js utilise déjà pour la synchro des favoris. Nécessite que
l'origine de la PWA soit autorisée via cors_allowed_origins (http: dans
configuration.yaml) — déjà requis pour que hasync.js fonctionne depuis la
PWA, donc probablement déjà en place si la synchro des favoris marche.

DEUX FORMES d'authentification, pas une seule :
  - En-tête Authorization: Bearer ... pour les appels JSON/texte faits en
    JS (fetch() peut poser un en-tête) — voir net.js.
  - Paramètre ?token=... pour tout ce qui est chargé directement par
    <video src="..."> ou le lecteur HLS natif de Safari : un élément
    <video> ne peut poser AUCUN en-tête personnalisé. C'est précisément le
    cas qui a motivé ce relais (iPhone/Safari) — donc requires_auth
    standard de Home Assistant (qui ne regarde que l'en-tête) ne suffit
    pas ici, l'authentification est vérifiée à la main pour accepter les
    deux formes.

Réécrit le contenu des manifestes HLS (.m3u8) pour que les segments et
sous-playlists qu'ils listent passent eux aussi par ce relais, jeton
compris (sinon seule la liste des chaînes serait débloquée : le lecteur
re-buterait sur le même mur dès qu'il irait chercher les segments vidéo
directement sur le serveur en http://).
"""
import logging
import re
from urllib.parse import quote, urljoin

from aiohttp import ClientTimeout, web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)
DOMAIN = "iptv_proxy"

# Types de contenu HLS reconnus, pour décider s'il faut réécrire le texte
# du manifeste plutôt que le relayer tel quel (certains serveurs IPTV ne
# déclarent pas un Content-Type exact, d'où le repli sur l'extension).
_M3U8_CONTENT_TYPES = ("mpegurl", "vnd.apple.mpegurl")

# Repris tels quels côté client, mais invalides ou trompeurs une fois
# relayés par ce serveur-ci (taille/encodage différents après réécriture
# éventuelle du manifeste, ou propres à la connexion amont).
_HEADERS_A_NE_PAS_RELAYER = {
    "content-encoding", "content-length", "transfer-encoding", "connection",
    "keep-alive", "host", "content-security-policy",
}

_TIMEOUT = ClientTimeout(total=30, sock_connect=10)


def _url_proxee(base_path: str, url_cible: str, jeton: str) -> str:
    return base_path + "?url=" + quote(url_cible, safe="") + "&token=" + quote(jeton, safe="")


def _reecrire_manifeste(texte: str, url_manifeste: str, base_path: str, jeton: str) -> str:
    """Remplace chaque URI de segment/sous-playlist par son équivalent
    proxifié (jeton compris), en résolvant les chemins relatifs contre
    l'URL du manifeste lui-même (comme le ferait n'importe quel lecteur
    HLS)."""
    out = []
    for ligne in texte.split("\n"):
        brute = ligne.rstrip("\r")
        stripped = brute.strip()
        if not stripped:
            out.append(brute)
            continue
        if stripped.startswith("#"):
            # Certaines balises (#EXT-X-KEY, #EXT-X-MAP...) portent elles
            # aussi une URI dans un attribut URI="..." — à réécrire aussi,
            # sinon les clés de déchiffrement ou l'initialisation fMP4
            # resteraient en http:// direct et rebloqueraient pareil.
            m = re.search(r'URI="([^"]+)"', brute)
            if m:
                cible = urljoin(url_manifeste, m.group(1))
                brute = brute.replace(m.group(1), _url_proxee(base_path, cible, jeton))
            out.append(brute)
            continue
        cible = urljoin(url_manifeste, stripped)
        out.append(_url_proxee(base_path, cible, jeton))
    return "\n".join(out)


class IptvProxyView(HomeAssistantView):
    """GET /api/iptv_proxy?url=<url encodée>&token=<jeton> (ou en-tête
    Authorization: Bearer <jeton>) — relaie la requête vers `url`."""

    url = "/api/iptv_proxy"
    name = "api:iptv_proxy"
    # Vérifiée à la main (voir _jeton_valide) : un <video src> ne peut pas
    # poser l'en-tête Authorization que requires_auth=True exigerait.
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    def _jeton_recu(self, request: web.Request) -> str:
        entete = request.headers.get("Authorization", "")
        if entete.startswith("Bearer "):
            return entete[7:]
        return request.query.get("token", "")

    async def _jeton_valide(self, jeton: str) -> bool:
        if not jeton:
            return False
        return await self._hass.auth.async_validate_access_token(jeton) is not None

    async def get(self, request: web.Request) -> web.StreamResponse:
        jeton = self._jeton_recu(request)
        if not await self._jeton_valide(jeton):
            return web.Response(status=401, text="jeton d'accès manquant ou invalide")

        url_cible = request.query.get("url")
        if not url_cible or not url_cible.startswith(("http://", "https://")):
            return web.Response(status=400, text="paramètre url manquant ou invalide")

        session = async_get_clientsession(self._hass)
        # Range (reprise/positionnement dans la vidéo) : transmis tel quel
        # au serveur amont, dont la réponse (206 Partial Content la plupart
        # du temps) est elle-même relayée sans y toucher plus bas.
        entetes_amont = {"User-Agent": "Mozilla/5.0 (compatible; LecteurIPTVProxy/1.0)"}
        if "Range" in request.headers:
            entetes_amont["Range"] = request.headers["Range"]

        try:
            amont = await session.get(url_cible, headers=entetes_amont, timeout=_TIMEOUT)
        except Exception as err:  # noqa: BLE001 — panne réseau amont, remontée telle quelle
            _LOGGER.warning("iptv_proxy: relais impossible vers %s : %s", url_cible, err)
            return web.Response(status=502, text="relais impossible : " + str(err))

        content_type = amont.headers.get("Content-Type", "")
        est_manifeste = url_cible.split("?", 1)[0].endswith(".m3u8") or any(
            t in content_type for t in _M3U8_CONTENT_TYPES
        )

        headers = {
            k: v for k, v in amont.headers.items()
            if k.lower() not in _HEADERS_A_NE_PAS_RELAYER
        }

        if est_manifeste:
            texte = await amont.text()
            # Résolu contre l'URL FINALE (après une éventuelle redirection
            # amont), pas l'URL demandée : sinon un chemin relatif dans le
            # manifeste pointerait au mauvais endroit.
            corps = _reecrire_manifeste(texte, str(amont.url), self.url, jeton)
            headers["Content-Type"] = content_type or "application/vnd.apple.mpegurl"
            return web.Response(status=amont.status, text=corps, headers=headers)

        # Binaire (segment vidéo, image, JSON de l'API Xtream...) : relayé
        # en continu plutôt que chargé entièrement en mémoire — un segment
        # vidéo peut peser plusieurs mégaoctets.
        reponse = web.StreamResponse(status=amont.status, headers=headers)
        await reponse.prepare(request)
        try:
            async for morceau in amont.content.iter_chunked(65536):
                await reponse.write(morceau)
        except (ConnectionResetError, ConnectionAbortedError):
            pass  # client parti en cours de route (zapping, fermeture du lecteur) — normal
        return reponse


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.http.register_view(IptvProxyView(hass))
    return True
