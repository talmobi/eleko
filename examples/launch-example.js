const electron = require( 'electron' )
const eleko = require( '../index.js' )

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

main()

async function main ()
{
  const launchApi = await eleko.launch()
  const userAgent = await launchApi.call( 'webContents.session.getUserAgent' )
  console.log( userAgent )

  // cancel or do something before requests
  await launchApi.onBeforeRequest( function ( details ) {
    const url = details.url

    const shouldBlock = (
      eleko.containsAds( url )
    )

    return shouldBlock
  } )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await launchApi.call( 'loadURL', url )

  console.log( ' == PAGE LOADED == ' )

  const now = Date.now()
  await launchApi.waitFor( 'video' )

  const title = await launchApi.evaluate(
    function ( selector ) {
      return document[ selector ]
    },
    'title'
  )

  console.log( 'title: ' + title )

  console.log( 'waited for: ' + ( Date.now() - now ) )

  await launchApi.evaluate(
    function () {
      const v = document.querySelector( 'video' )
      v.pause()
      v._play = v.play
      v.play = function () {}
    }
  )

  console.log( 'waiting 5 seconds' )
  await new Promise( r => setTimeout( r, 1000 * 5 ) )
  console.log( 'waiting done, playing...' )

  await launchApi.evaluate(
    function () {
      const v = document.querySelector( 'video' )
      v._play()
    }
  )
}

