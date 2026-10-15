# Modules Cockpit pour un serveur LXC

Trois modules pour [Cockpit](https://cockpit-project.org/), l'interface web d'administration Linux, développés pour administrer mon VPS de production (Debian 12, conteneurs LXC derrière un reverse proxy Nginx).

| Module | Rôle |
|---|---|
| **Conteneurs LXC** | Liste des conteneurs avec CPU, mémoire et IP ; démarrer, arrêter, redémarrer, geler ; snapshots et restauration ; création depuis les images officielles ; journaux et diagnostics (processus, ports, disque, mises à jour) ; table « domaine vers conteneur » lue dans la config Nginx. |
| **Journaux centralisés** | Lecture des journaux reçus par un conteneur rsyslog central : filtre par machine, recherche texte ou regex sur toutes les machines, suivi en direct, graphique des erreurs par heure, rapports quotidiens. |
| **Sécurité et tâches** | Prisons fail2ban de l'hôte et de chaque conteneur, historique des bannissements, fiche d'une IP (whois, DNS inverse, requêtes Nginx, tentatives SSH), ban / unban, timers systemd et crontabs, certificats TLS (expiration, certificat réellement servi), ports ouverts, mises à jour en attente, connexions récentes, sauvegardes. |

## Conception sécurité

Le compte Cockpit n'est **pas administrateur** de la machine. Chaque module s'appuie sur un petit assistant Python lancé via `sudo`, et la règle sudoers n'autorise que ce fichier précis (principe du moindre privilège).

- **Liste blanche** de sous-commandes ; tous les arguments sont validés (expressions régulières, module `ipaddress`) et comparés à l'état réel (conteneur, prison ou timer existant).
- **Aucun shell** : les commandes sont lancées avec `subprocess` sous forme de liste, jamais en concaténant du texte.
- **Chemins résolus** (`realpath`) puis vérifiés : un lien symbolique posé dans un conteneur ne permet pas de lire un fichier de l'hôte.
- **Anti-XSS** : l'interface n'utilise jamais `innerHTML`. Les journaux contiennent du texte contrôlé par les attaquants (user-agent, URL…), il est toujours inséré avec `textContent`.
- **Garde-fous** : impossible de bannir une adresse privée ou celle du réseau des conteneurs, confirmation par saisie du nom avant suppression, verrou contre les opérations simultanées.
- **Traçabilité** : chaque action (ban, arrêt, snapshot, suppression…) est journalisée dans syslog avec le nom de l'utilisateur.

## Structure

```
modules/      interface web (HTML/CSS/JS), à copier dans /usr/share/cockpit/
  studio/     thème et utilitaires partagés (fonction h() de création du DOM sans innerHTML)
  lxc/  logs/  securite/
helpers/      assistants privilégiés, à copier dans /usr/local/libexec/ (root:root, 755)
sudoers/      règles à copier dans /etc/sudoers.d/ (root:root, 440)
```

## Installation

```bash
sudo cp -r modules/* /usr/share/cockpit/
sudo install -o root -g root -m 755 helpers/* /usr/local/libexec/
# remplacer « admin » par votre compte Cockpit, puis vérifier la syntaxe
sudo install -o root -g root -m 440 sudoers/* /etc/sudoers.d/
sudo visudo -c
```

Les chemins et le réseau (`/var/lib/lxc`, `10.0.3.0/24`, conteneur `nginx` en `10.0.3.10`, conteneur `logs`) correspondent à mon installation et se règlent en tête de chaque assistant.

## Licence

MIT
