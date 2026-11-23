# was used to originally build the upload pages
# they are built into the web-api package, not necessary
import os

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'uploads')

KINDS = [
    dict(key='fairytale', file='fairytale.html', name='Fairy Tale',
         lead="Send us a story about your Fairy in Pixie Hollow. Make sure your story is one you've written yourself!",
         title=True, picture=False, rows=16, max=5000,
         bodyLabel='Your Story:', bodyTip='At least 50 letters.',
         submit='Send In My Story'),
    dict(key='poem', file='poem.html', name='Poem',
         lead='Calling all pixie poets! Send in your original poem here!',
         title=True, picture=False, rows=12, max=2000,
         bodyLabel='Your Poem:', bodyTip='',
         submit='Send In My Poem'),
    dict(key='question', file='question.html', name='Questions for Tabby',
         lead='Ask Tabby a question about Pixie Hollow! Remember, only a few questions can be answered each week, but one of them could be yours.',
         title=False, picture=False, rows=5, max=300,
         bodyLabel='Your Question:', bodyTip='Only a few questions can be answered each week.',
         submit='Ask Tabby'),
    dict(key='art', file='art.html', name='Art',
         lead='We want to see your latest Pixie Hollow masterpiece! Draw it on your computer or draw it on paper and scan it.',
         title=True, picture=True, rows=4, max=300,
         bodyLabel='About Your Art:', bodyTip='Optional. Tell us about it!',
         submit='Send In My Art'),
]

TITLE_ROW = '''              <div class="formRow">
                <label for="uploadTitle">Title:</label>
                <div>
                  <input class="textInput" id="uploadTitle" maxlength="80" autocomplete="off" />
                  <p class="fieldError" id="uploadTitleError"></p>
                </div>
              </div>

'''

PICTURE_ROW = '''              <div class="formRow">
                <label for="uploadFile">Your Picture:</label>
                <div>
                  <input type="file" id="uploadFile" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" />
                  <p class="fieldTip">A PNG, JPEG, GIF, WEBP or BMP picture, up to 4 MB.</p>
                  <img class="uploadPreview" id="uploadPreview" alt="" hidden />
                  <p class="fieldError" id="uploadFileError"></p>
                </div>
              </div>

'''

PAGE = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{name} - Uploads</title>
  <meta name="description" content="{lead}" />
  <link rel="icon" href="/wings.ico" type="image/x-icon" />
  <link rel="preload" href="/site/nav.xml" as="fetch" />
  <link rel="stylesheet" href="/site/nav/nav.css?v=20260926m" />
  <link rel="stylesheet" href="/site/site.css?v=20260928a" />
  <link rel="stylesheet" href="/site/account.css?v=20260926m" />
  <link rel="stylesheet" href="/site/uploads.css?v=20260929d" />
</head>
<body class="interiorPage" data-kind="{key}" data-nav-path="/uploads/{file}">
  <div class="siteWrap">
    <nav id="mainNav" aria-label="Main"></nav>
    <div class="memberBar" data-member-bar hidden></div>

    <main class="pageFrame">
      <div class="pageInner">
        <div class="frameLogo"></div>
        <p class="breadCrumbs"><a href="/events.html">Pixie Central</a> &gt; <a href="/uploads.html">Upload</a> &gt; <span>{name}</span></p>
        <h1 class="pageTitle">{name}</h1>

        <p class="pageLead uploadIntro">{lead}</p>

        <section class="acctBoxes" id="uploadLogin" hidden>
          <div class="acctBox">
            <h3>Log In to Send Something In</h3>
            <p>You need to be logged in so we know which Fairy it's from. <a href="#" data-login>Log in</a> or <a href="/register.html">create a Fairy</a>.</p>
          </div>
        </section>

        <section class="acctBoxes uploadWide" id="uploadFormBox" hidden>
          <div class="acctBox">
            <h3>{name}</h3>
            <form class="acctForm" id="uploadForm" novalidate>
              <div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">
                <label>Leave this empty <input id="uploadWebsite" tabindex="-1" autocomplete="off" /></label>
              </div>

{title_row}{picture_row}              <div class="formRow">
                <label for="uploadBody">{bodyLabel}</label>
                <div>
                  <textarea class="textInput textArea" id="uploadBody" rows="{rows}" maxlength="{max}"></textarea>
                  <p class="fieldTip"><span id="uploadCount"></span>{tip}</p>
                  <p class="fieldError" id="uploadBodyError"></p>
                </div>
              </div>

              <p class="fieldTip">A person reads everything before anyone else can see it. Please don't include your real name, e-mail, or anything private.</p>
              <p class="formMessage" id="uploadMessage" role="alert"></p>
              <p class="center"><button class="btnGray" type="submit" id="uploadSubmit">{submit}</button></p>
            </form>
          </div>
        </section>

        <section class="acctBoxes" id="uploadThanks" hidden>
          <div class="acctBox">
            <h3>Thank you!</h3>
            <p>Your submission has been successfully uploaded! Keep checking the Pixie Postings and the Art Gallery to see if your entry was picked!</p>
            <p class="center"><button class="btnGray" type="button" id="uploadAnother">Send Another</button></p>
          </div>
        </section>

        <section class="acctBoxes" id="uploadMine" hidden>
          <div class="acctBox">
            <h3>What You've Sent In</h3>
            <ul class="uploadList" id="uploadList"></ul>
          </div>
        </section>
      </div>
    </main>
  </div>

  <script src="/site/site.js?v=20260926m"></script>
  <script src="/site/nav.js?v=20260926m"></script>
  <script src="/site/loginModal.js?v=20260926m"></script>
  <script src="/site/uploads.js?v=20260929d"></script>
</body>
</html>
'''

for kind in KINDS:
    html = PAGE.format(
        title_row=TITLE_ROW if kind['title'] else '',
        picture_row=PICTURE_ROW if kind['picture'] else '',
        tip=(' ' + kind['bodyTip']) if kind['bodyTip'] else '',
        **{k: v for k, v in kind.items() if k not in ('title', 'picture')}
    )
    with open(os.path.join(HERE, kind['file']), 'w', encoding='utf-8', newline='\n') as out:
        out.write(html)
    print('wrote', kind['file'])
