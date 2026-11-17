# Sharing and teams

Everything you make in Waymark is private until you share it. You can share with specific people, with groups, by public link, inside other websites, and on your own public page.

## Who can do what

Every story, map, hosted layer and dashboard has one **owner**: the person who made it. The owner can give other people access as an **editor** or a **viewer**.

| Action | Owner | Editor | Viewer |
| --- | :---: | :---: | :---: |
| Open it and see the latest draft | ✓ | ✓ | ✓ |
| Change it (edit a story, a map, a layer's data, a dashboard) | ✓ | ✓ | |
| Manage a hosted layer's forms and sync settings, restore versions | ✓ | ✓ | |
| Publish or unpublish a story | ✓ | | |
| Share it, turn on its public link, show it on a public page | ✓ | | |
| Delete it | ✓ | | |

Things shared with you appear in your own lists on the home screen, labeled with the owner's name and your role, such as **Ana · can edit** or **Ana · view only**. Viewers open stories as a preview and maps as a public-style page.

## Share with people and groups

1. On the home screen, open the item's **⋯** menu and choose **Share…**. (Dashboards and scenarios also have **Share** in their top bar.)
2. Under **People and groups**, type the email of someone's Waymark account, choose **Can view** or **Can edit**, and select **Share**.
3. Or select a group under **Share with a group**.
4. Change anyone's access with the menu beside their name, or remove them with **×**.
5. Select **Done**.

People need a Waymark account before you can share with them; the email must match their account. If they don't have one yet, ask them to sign up first.

### What comes along

When you share a story, the people you share it with can also open the saved maps it uses and the hosted layers on those maps, read-only, so the story works for them. When you share a map, they can read its hosted layers. This only applies to maps and layers you can open yourself: putting someone else's map in your story never gives anyone access to it.

To let someone *change* a map or layer used in a shared story, share the map or layer with them directly as an editor.

## Groups

Groups let you share with several people at once. Make them on the **Team** tab of the home screen.

**To make a group**
1. Open the **Team** tab and select **New group**.
2. Name it, such as "Field team".
3. Add people by the email of their account and select **Add**.

| Role in a group | Can |
| --- | --- |
| **Owner** (who made it) | Add and remove people, make people admins, rename and delete the group. |
| **Admin** | Add and remove people, rename the group. |
| **Member** | Use what's shared with the group. Leave the group. |

When you share something with a group, everyone in it gets that access, including people added later. When someone leaves or is removed, they lose what came through the group. Deleting a group stops everything shared with it being shared with its members; nobody's own work is affected.

## Public links

| Item | How to make it public | Address |
| --- | --- | --- |
| Story | Publish it. See [Publish and update](publish.md). | `/s/your-link` |
| Saved map | **Share…** → **Anyone with the link can view this map**. | `/m/<id>` |
| Dashboard | **Share…** → **Anyone with the link can view this dashboard**. | `/d/<id>` |
| Hosted layer | **Share…** → **Anyone with the link can load this layer's data**. | `/api/public/layers/<id>.geojson` |
| Form | Every form has a public link. See [Forms](forms.md). | `/f/<id>` |

A public map page shows the map with its legend, its time slider, and a menu of its bookmarks with their notes. A public dashboard is fully interactive. Nobody can change anything through a public link.

When a story is published, or a map or dashboard is made public, the saved maps and hosted layers it uses become readable through it too, so it works for everyone.

> [!WARNING]
> Anything public can be seen by anyone who has the link, and links can be passed on. Don't make layers with personal or sensitive information public.

## Embed in a website

Stories, maps and dashboards with public links can be placed inside other web pages, such as a news site, a project page or an intranet.

1. Open **Share…** for the item.
2. Copy the code under **Embed in a website**.
3. Paste it into your website's HTML.

The embedded version hides Waymark's top bar and fits the space it's given. The code looks like this:

```html
<iframe src="https://stories.example.org/m/abc123?embed=1" width="100%" height="600" style="border:0" loading="lazy" allowfullscreen></iframe>
```

Change `height` to suit your page. To embed a story, its link must be published.

## Your public page

Your public page lists the stories, maps and dashboards you choose to show, at an address like `/u/your-name`. It's a simple portfolio for your work.

**To set it up**
1. Select the circle with your initial (top right of the home screen) and choose **Your public page**.
2. Enter the **Name shown**, a **Page address** (3 to 30 lowercase letters, numbers and dashes) and, optionally, **About** text.
3. Select **Save**.

**To show something on it**, open the item's **Share…** and tick **Show it on my public page**. Only published stories, and maps and dashboards with a public link, can be shown. Nothing appears on your page until you choose it, and your email is never shown.

To remove your public page, clear the page address and save.
