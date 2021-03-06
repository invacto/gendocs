import commandMessages from "./commandMessages"
import logger from "./logger"
import cli from "./cli"
import configHandler from "./configHandler"
import documentHandler from "./documentHandler"
import repository from "./repository"
import path from "path"
import authHandler from "./authHandler"
import initHandler from "./initHandler"

const _handlers: {[command: string]: (args: string[]) => void} = {
  help: (args: string[]) => {
    if (args.length > 0) {
      const target: string = args[0]
      if (target in commandMessages) {
        logger.info(commandMessages[target]())
        return
      }
    }
    logger.info(commandMessages.help())
  },
  "register": async (args: string[]) => {
    logger.info(`
      Registration is currently only possible after an invitation.
      If you would to use Gendocs please send an email to ian@invacto.com
    `)
    const invitation = await cli.promptInvitation()

    try {
      await repository.validateInvitation(invitation)
    } catch (e) {
      if (e.response.status === 401) {
        logger.info(`
          The given invitation is invalid or has already been used.
        `)
      } else {
        throw e
      }
      return
    }
    
    const email = await cli.promptEmail()
    const validationResult = await repository.doesEmailExist(email)
    if (validationResult.exists) {
      logger.info(`
        That email address has already been used.
      `)
      return
    }
    
    const password = await cli.promptPassword()
    try {
      await repository.createUser(invitation, email, password)
      logger.info("Registration was succesful!")
    } catch (e) {
      if (e.response.status === 401) {
        logger.info(`
          The given invitation is invalid or has already been used.
        `)
        return
      }
      throw e
    }
  },
  "docs:create": async (args: string[]) => {
    const email = await cli.promptEmail()
    const password = await cli.promptPassword()
    const name = await cli.promptDocName()

    const response = await repository.createDocument(name, email, password)
    logger.info(`
      Document created successfully! 
      Your token: ${response.doc.token}

      Use "gendocs init" in the directory where you'd like your config file to live.

      If you lose the token, try using "gendocs docs:list" to recover it.
    `)
  },
  "docs:list": async (args: string[]) => {
    const email = await cli.promptEmail()
    const password = await cli.promptPassword()

    const response = await repository.listDocuments(email, password)
    logger.info(`
      [Your documents]
    `)
    response.docs.forEach((doc: any) => {
      logger.info(`- ${doc.name} : ${doc.token} @ ${doc.full_subdomain}`)
    });
  },
  "docs:rename": async (args: string[]) => {
    const token = await authHandler.getToken()
    if (token == null) return
    
    const name = await cli.promptDocName("New doc name:")
    if (name == null) return

    await repository.updateDocument(token, { name })
    configHandler.updateConfig({ name })
    logger.info(`Doc has been updated.`)
  },
  "docs:remove": async (args: string[]) => {
    const token = await cli.promptToken()
    if (token == null) return

    const data = await repository.deleteDocument(token)
    logger.info(`Doc "${data.doc.name}" has been removed.`)
  },
  init: async (args: string[]) => {
    const token = await cli.promptToken()

    const response = await repository.singleDocument(token)
    await initHandler.init(response.doc.name, token)
  },
  publish: async (args: string[]) => {
    const config = await configHandler.readConfigFile()
    if (config == null) {
      logger.error(`
        Config file could not be found.
        Use "gendocs init" to generate the config file.
      `)
      return
    }
    const token = await authHandler.getToken(args)
    if (token == null) {
      throw Error(`
        We couldn't find a token to authenticate you.
        Please provide a token in one of these ways:
          - in a gendocs-token file
          - in a gendocs.json file
          - as a argument to "gendocs publish [token]"
      `)
    }
    
    let pages
    const sourcePath = config.sourcePath || ""
    pages = config.pages.map(p => path.join(sourcePath, p))

    const generatedPages = await documentHandler.loadPages(pages)
    if (generatedPages.length === 0) {
      logger.info(`
        No pages were found.
        Please add your pages to gendocs.json.

        Example:

          {
            name: "${config.name}",
            token: "***********",
            pages: [
              "./my_page",
            ]
          }
      `)
      return
    }

    try {
      if (config["token"] != null) {
        delete config["token"]
      }
      const result = await repository.publish(token, generatedPages, config)
      if (result.doc.subdomain == null && result.domains.length == 0) {
        logger.info(`
        Succesfully updated your documentation!
        You don't seem to have selected a subdomain yet.
        
        Please select a subdomain using the command: gendocs subdomain:set
        or
        Add your own custom domain using the command: gendocs domains:add
        `)
      } else {
        let domains = result.domains
        if (result.doc.subdomain != null) {
          domains.push({full_url: result.doc.full_subdomain})
        }
        let text = `
        Succesfully updated your documentation!

        Your site is available at:`
        domains.forEach((domain: {full_url: string}) => {
          text += `\n\t   - ${domain.full_url}`
        });

        logger.info(text + "\n")
      }
    } catch (e) {
      if (e.response.status === 403) {
        logger.info(`
          You've hit the publishes/minute limit. Please wait a minute before you try again.
        `)
        return
      }
      throw e
    }
  },
  "subdomain:set": async (args: string[]) => {
    const token = await authHandler.getToken()
    if (token == null) return

    updateSubdomain(token)
  },
  "domains:add": async (args: string[]) => {
    const token = await authHandler.getToken()
    if (token == null) return
    const domain = await cli.promptDomain()
    await repository.addDomain(token, domain)
    
    logger.info(`
    Generating SSL Certificate...
    `)


    let timeout: any
    const interval = setInterval(async () => {
      const result = await repository.domainStatus(domain)
      if (result.status === "ok") {
        logger.info(`
    Your domain has been added!
    The site is now available at https://${domain}/
        `)

        if (timeout != null) {
          clearTimeout(timeout)
        }
        clearInterval(interval)
        return
      }
      if (result.status === "pending") {
        return
      }
      if (result.status === "error") {

        if (result.context == "invalid_domain") {
          logger.info(`
    The domain "${domain}" seems to be malformed.
    Please make sure your domain is in the format somedomain.com
          `)
          return
        }
        
        logger.error(`
    Something seems to have gone wrong while trying to generate your ssl certificates.
    Error code: ${result.context}
        `)

        if (timeout != null) {
          clearTimeout(timeout)
        }
        clearInterval(interval)
      }
    }, 500)

    timeout = setTimeout(() => {
      logger.error("Something seems to have gone wrong. Please contact us through our github.")
      clearInterval(interval)
    }, 20000)
  }
}

async function updateSubdomain(token: string) {
  let {subdomain} = await cli.promptSubdomain()
  if (subdomain == null) return

  try {
    const result = await repository.tryAddingSubdomain(token, subdomain)
    logger.info(`
      Your site is now available at: ${result.doc.full_subdomain}
    `)
  } catch (e) {
    if (e.response.status === 400) {
      logger.info(`Subdomain "${subdomain}" has already been taken.`)
      updateSubdomain(token)
    }
  }
}

function handleCommandHandlerError(e: any) {
  if (e.response == null) {
    logger.error(e.message, e)
    return
  }
  if (e.response.status != null) {
    if (e.response.status === 401) {
      logger.error("Unauthorized")
      return
    }
  }
  if (e.response != null && e.response.data != null && e.response.data.errors != null) {
    const errors = e.response.data.errors
    for (const key in errors) {
      if (typeof errors[key] === "string") {
        logger.error(errors[key])
      } else {
        for (const message of errors[key]) {
          logger.error(`${key} ${message}`)
        }
      }
    }
  } else {
    logger.error(e.message)
  }
}

async function run() {
  if (process.argv.length < 3) {
    logger.info(commandMessages.help())
    return
  }

  const command: string = process.argv[2]
  if (!(command in _handlers)) {
    logger.info(commandMessages.help())
    return
  }

  let args: string[] = []
  if (process.argv.length > 3) {
    args = process.argv.slice(3)
  }

  try {
    await Promise.resolve(_handlers[command](args))
  } catch (e) {
    handleCommandHandlerError(e)
  }
}

export default {
  run
}