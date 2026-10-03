package io.allurx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用于观察 Spring Boot 2.1.5.RELEASE 的默认 Servlet 安全链。
 *
 * @author allurx
 */
@SpringBootApplication
@RestController
public class SecurityBasicsApplication {
    public static void main(String[] args) {
        SpringApplication.run(SecurityBasicsApplication.class, args);
    }

    @GetMapping("/")
    public String index() {
        return "authenticated";
    }
}
