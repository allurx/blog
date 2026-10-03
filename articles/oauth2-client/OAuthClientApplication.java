package io.allurx;

import java.security.Principal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用于学习 Spring Security 5.2.2.RELEASE 授权码登录的本地入口。
 *
 * @author allurx
 */
@SpringBootApplication
@RestController
public class OAuthClientApplication extends WebSecurityConfigurerAdapter {
    public static void main(String[] args) {
        SpringApplication.run(OAuthClientApplication.class, args);
    }

    @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
    public String index() {
        return "<a href=\"/oauth2/authorization/github\">使用 GitHub 登录</a>"
                + "<p><a href=\"/user\">查看当前主体</a></p>";
    }

    @GetMapping("/user")
    public String user(Principal principal) {
        return principal.getName();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests(requests -> requests
                    .antMatchers("/", "/error").permitAll()
                    .anyRequest().authenticated())
                .exceptionHandling(exceptions -> exceptions
                    .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .oauth2Login();
    }
}
